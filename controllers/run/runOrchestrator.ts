// G05.04 (issue #215) — the framework-free run orchestrator: the RC column of
// 19 §4.3 minus React and persistence (G05.05 owns useRunController, the store
// and the durable row). One path for every input, manual or physical (09 §6.4,
// 19 §5.2): services/location raw fix → core/pipeline acceptFix → only the
// accepted events enter core/engine step() → commands → services/audio and the
// location window. The orchestrator owns no business rule — a trigger decision
// lives in the engine, a fix decision in the pipeline; anything this file
// would have to decide is a gap to fix in step() with its own test.
//
// Deliberate wiring decisions, recorded once:
// 1. The audio service's `paused`/`resumed` events reach nobody here: the
//    orchestrator issues them itself (pause()/resume()) and the engine state
//    already committed at the intent (UserPausedAudio/ResumeAudio) — a second
//    dispatch would double-apply the transition. A physical pause WITHOUT a
//    focus loss (the adapter's own source event, G05.03.b) has no engine event
//    yet; its mapping is that adapter's contract decision, out of scope here.
// 2. A rejected fix dispatches nothing: the pipeline returns the previous
//    state and no events, so the engine's last_fix keeps the last ACCEPTED
//    position (criterion 3 — a spike fix cannot unlock a deferred play).
// 3. Pipeline candidates are the whole selected stop set (AR-5: the pipeline
//    knows nothing about heard/auto_fired); the engine re-checks §4.8 at the
//    trigger, so a heard or locked stop's DwellCompleted is ignored there.
// 4. The Start-time window seed is the selection filtered by the Start
//    payload's accessibleStopIds; the tier dimension refines through the
//    engine's own SetGeofenceWindow commands (AccessReady, Resume) — the
//    orchestrator never recomputes eligibility itself.
// 5. The moment token is minted here (ADR G01.02 §3.2 — the controller mints,
//    the engine validates the echo) with an instance-scoped monotonic seq
//    (the composition root holds one controller per process).
// 6. Commands with no consumer in this layer (ScheduleTimer, CancelTimer,
//    PersistProgress, EmitEvent, ShowArrivalCard) are G05.05's persistence,
//    telemetry and UI surface — deliberately dropped here, not silently lost:
//    the exhaustive switch makes adding a command a compile-visible decision.
// 7. G05.05 (issue #216) adds two optional durability deps. The services/
//    download capability port is the only AccessReady delivery path into the
//    engine (ADR G01.03 §3.5): its handler is registered here, where dispatch
//    is private, so no public method accepts an AccessReady-shaped event and
//    a look-alike from any other source has no route into step(). The
//    onCommitted hook runs on step()'s PROPOSED state, before the orchestrator
//    commits it — the durability point where useRunController writes the
//    durable delta and only then publishes (ADR §3.1/§3.3; R2, G20.03): a
//    failing hook rejects the whole transition, so no effect ever fires for a
//    state the durable row does not hold.
// 8. G20.04 (issue #475, runtime.md R3): the constructor registers nothing.
//    The GPS sink and the access channel are the session's: they attach only
//    when a session is accepted (start()) or restored (restore()) and release
//    on end(), retire() and dispose() — a candidate controller that is never
//    accepted holds no such registration, so a refused second walk cannot
//    steal the live walk's GPS. The audio events are the controller's:
//    they attach with the session but survive end()/retire() (a moment
//    launch outlives the session, ADR G01.02 §3.8, and its finish must
//    clear the Ended mirror — the reducer still accepts tagged player
//    callbacks while Ended), releasing only on dispose(). Every release
//    removes only this orchestrator's own registration.
import { acceptFix } from '../../core/pipeline/pipeline.ts';
import {
  initialPipelineState,
  type FixInput,
  type PipelineCandidate,
  type PipelineConfig,
  type PipelineState,
} from '../../core/pipeline/types.ts';
import { step, type EngineConfig } from '../../core/engine/reducer.ts';
import type { RunCommand } from '../../core/engine/commands.ts';
import type { RunEvent } from '../../core/engine/events.ts';
import { initialRunState, type Locale, type RunSessionState, type RunState, type Tier } from '../../core/engine/state.ts';
import type { LocationService } from '../../services/location/service.ts';
import type { GeofenceStop } from '../../services/location/types.ts';
import type { AudioService } from '../../services/audio/service.ts';
import type { AudioServiceEvent } from '../../services/audio/types.ts';
import type { DownloadAccessPort } from '../../services/download/access.ts';

// One selected stop of the route: the engine's package identity plus the
// geometry the pipeline candidates and the geofence window both need.
export interface RunStop extends GeofenceStop {
  storyBaseId?: string;
  storyExtendedId?: string;
}

export interface RunClock {
  now(): number;
}

export interface RunRoute {
  routeId: string;
  version: string;
  locale: string;
  tier: Tier[];
}

export interface RunOrchestratorDeps {
  location: LocationService;
  audio: AudioService;
  // The same clock instance the two services hold, so the pipeline's
  // timestamps, the engine's freshness windows and the watchdog agree.
  clock: RunClock;
  engineConfig: EngineConfig;
  pipelineConfig: PipelineConfig;
  route: RunRoute;
  stops: ReadonlyArray<RunStop>;
  // Header note 7: optional for the G05.04 scenarios, always passed by
  // useRunController.
  access?: DownloadAccessPort;
  // G07.02 (ADR G01.02 §3.2): ONE process-wide counter over every moment
  // launch — the composition root mints it once and hands the same source to
  // the moment controller; without it the orchestrator counts its own
  // (two counters could mint the same token value for two launches).
  nextMomentSeq?: () => number;
  // G07.02 (ADR G01.02 §3.3/§3.8): the idle moment controller's live launch
  // facts, read at Start — a walk started while a no-session Moment sounds
  // inherits the occupied player instead of stopping it by autoplay command.
  // Null/paused inherit nothing (a paused launch is not «sounding»).
  currentMomentPlay?: () => {
    readonly momentId: string;
    readonly storyId: string;
    readonly seq: number;
    readonly paused: boolean;
  } | null;
  // Header note 7: the durability point — after the engine committed an
  // event, before its effects fire.
  onCommitted?: (before: RunState, after: RunState) => void;
}

export class RunOrchestrator {
  private readonly location: LocationService;
  private readonly audio: AudioService;
  private readonly access: DownloadAccessPort | undefined;
  private readonly clock: RunClock;
  private readonly engineConfig: EngineConfig;
  private readonly pipelineConfig: PipelineConfig;
  private readonly route: RunRoute;
  // Not readonly: restore() swaps the set to the pinned package's records
  // (ADR G01.03 §3.4 — a newer catalog never substitutes its geometry).
  private stops: ReadonlyArray<RunStop>;
  // Not readonly either: restore() rebuilds it with the swapped stop set.
  private candidates: ReadonlyMap<string, PipelineCandidate>;
  private readonly onCommitted: ((before: RunState, after: RunState) => void) | undefined;
  // Not readonly when no injected source is given: the fallback counter
  // lives here (the pre-G07.02 behavior, backward compatible for tests).
  private nextMomentSeq: () => number;
  private readonly currentMomentPlay: RunOrchestratorDeps['currentMomentPlay'];

  private engineState: RunState = initialRunState;
  private pipelineState: PipelineState = initialPipelineState;
  private ownMomentSeq = 0;
  // G20.04 (header note 8): the live resource registrations, per resource.
  // The audio subscription is the controller's: a moment launch survives End
  // (ADR G01.02 §3.8) and the reducer still accepts the tagged player
  // callbacks of the Ended session — a moment finishing in that window must
  // reach the engine to clear the mirror, so it survives end()/retire() and
  // releases only on dispose() (or re-registration after a full detach). The
  // GPS sink and the access channel are the session's: a candidate holds
  // neither, they attach on acceptance/restore and release on end()/retire().
  private audioRelease: (() => void) | null = null;
  private locationRelease: (() => void) | null = null;
  private accessRelease: (() => void) | null = null;
  // G07.03 — the one-shot carry of playMoment's resolved teaser path to the
  // effect that fires inside the same synchronous dispatch (the engine's
  // command carries no path — content resolution is not the engine's read).
  private pendingMomentPath: { seq: number; path: string } | null = null;

  constructor(deps: RunOrchestratorDeps) {
    this.location = deps.location;
    this.audio = deps.audio;
    this.access = deps.access;
    this.clock = deps.clock;
    this.engineConfig = deps.engineConfig;
    this.pipelineConfig = deps.pipelineConfig;
    this.route = deps.route;
    this.stops = deps.stops;
    this.onCommitted = deps.onCommitted;
    this.nextMomentSeq = deps.nextMomentSeq ?? (() => ++this.ownMomentSeq);
    this.currentMomentPlay = deps.currentMomentPlay;
    this.candidates = new Map(
      deps.stops.map((stop) => [stop.stopId, { lat: stop.lat, lng: stop.lng, radius: stop.radius }]),
    );
  }

  // The subscription transfer of R3: only an accepted (start) or restored
  // (recover) session takes the resources. Each registration attaches at
  // most once — a second attach adds nothing; a re-Start after end()
  // re-attaches what end() released.
  private attachResourceSubscriptions(): void {
    if (this.audioRelease === null) {
      this.audioRelease = this.audio.onEvent((event) => this.onAudioEvent(event));
    }
    if (this.locationRelease === null) {
      this.locationRelease = this.location.onFix((fix) => this.onFix(fix));
    }
    if (this.access !== undefined && this.accessRelease === null) {
      this.accessRelease = this.access.onAccessReady((event) => this.dispatch(event));
    }
  }

  // The session-scoped cleanup of R3 (end, switch): the GPS sink and the
  // access channel release here; every release removes only this
  // orchestrator's own registration, so a released owner never detaches the
  // walk that took the resources after it. The audio subscription stays —
  // the surviving moment's finish must clear the Ended mirror.
  private detachSessionSubscriptions(): void {
    this.locationRelease?.();
    this.locationRelease = null;
    this.accessRelease?.();
    this.accessRelease = null;
  }

  // R3's total lifecycle: releases every service registration this
  // orchestrator still holds, idempotently and without touching any shared
  // resource — the mode, the window and the physical player belong to
  // end()/retire(), not to the listener cleanup.
  dispose(): void {
    this.detachSessionSubscriptions();
    this.audioRelease?.();
    this.audioRelease = null;
  }

  // Read-only engine view for the UI layer (G05.05) and the scenario tests:
  // the single owner of progress is the reducer, this only hands out its state.
  get state(): RunState {
    return this.engineState;
  }

  // 19 §4.3: a repeated Start after End opens a fresh session (new session
  // row, new session_id) — the reducer accepts Start only from Idle, so the
  // Ended mirror and the pipeline's smoothing window are reset here first. A
  // moment launch survives End (ADR G01.02 §3.8): the fresh session inherits
  // the occupied player through Start's playingNow, or the first guide launch
  // would stop a sounding moment by command — the Start contract forbids that
  // (ADR §3.3). A Start while a session is live stays the reducer's no-op
  // (one live session, ADR G01.03 §3.1).
  // `verifiedTiers` (G05.05.a) is the readiness-verified layer list of this
  // start (ADR G01.03 §3.1: the row's tier records what Start verified) —
  // a paid walk re-entered after both layers were activated starts with both;
  // without it the route's default selection applies.
  // `audio` (ADR G21.20 §3.2) is the resolved audio pin of this start: null =
  // the text-only session, a locale = the pinned audio layer with its
  // verified tiers; undefined = the monolingual default (the audio layer is
  // the text layer). The controller always resolves one of the three before
  // calling.
  start(
    sessionId: string,
    accessibleStopIds?: ReadonlyArray<string>,
    verifiedTiers?: Tier[],
    audio?: { locale: Locale | null; tiers?: ReadonlyArray<Tier> },
  ): void {
    // The acceptance takes the resources (R3, header note 8) — the store's
    // commit already happened in the caller.
    this.attachResourceSubscriptions();
    let playingNow: { momentId: string; storyId: string; seq: number } | undefined;
    if (this.engineState.phase === 'Ended') {
      const ended = this.engineState;
      // A paused launch is not «sounding»: Start's playingNow has no pause
      // flag, so inheriting one would present a paused source as playing
      // (and a later resume of the token would be refused). The next launch
      // frees the source by the one-player rule instead.
      if (ended.playing?.owner === 'moment' && !ended.playing.paused) {
        playingNow = {
          momentId: ended.playing.momentId,
          storyId: ended.playing.storyId,
          seq: ended.playing.seq,
        };
      }
      this.engineState = initialRunState;
      this.pipelineState = initialPipelineState;
    }
    // G07.02 (ADR §3.8): a walk started while a no-session Moment sounds
    // inherits the occupied player — a fresh orchestrator has no Ended
    // mirror to read, so the idle controller's live launch facts are the
    // source. The same not-paused rule: a paused launch is not «sounding»,
    // the next launch frees the source by the one-player rule instead.
    if (playingNow === undefined) {
      const idle = this.currentMomentPlay?.() ?? null;
      if (idle && !idle.paused) {
        playingNow = { momentId: idle.momentId, storyId: idle.storyId, seq: idle.seq };
      }
    }
    const ids = accessibleStopIds ?? this.stops.map((stop) => stop.stopId);
    this.dispatch({
      type: 'Start',
      sessionId,
      routeId: this.route.routeId,
      version: this.route.version,
      locale: this.route.locale,
      tier: verifiedTiers ?? this.route.tier,
      ...(audio === undefined
        ? {}
        : { audioLocale: audio.locale, ...(audio.tiers ? { audioTier: [...audio.tiers] } : {}) }),
      accessibleStopIds: [...ids],
      ...(playingNow ? { playingNow } : {}),
      stops: this.stops.map(({ stopId, storyBaseId, storyExtendedId }) => ({
        stopId,
        storyBaseId,
        storyExtendedId,
      })),
    });
    this.location.setMode('active-guide');
    const permitted = new Set(this.session().accessibleStopIds);
    this.location.setGeofenceWindow(this.stops.filter((stop) => permitted.has(stop.stopId)));
  }

  // The user intents of the Run screen. Each is one dispatch — the manual tap
  // and the GPS trigger share the path (09 §6.4). The session intents return
  // whether a live transition happened, so the controller fires its own phase
  // effects (the wakelock, 11 §6) only on a real change; the location mode is
  // this file's effect (the parity suite anchors the wakelock and the
  // unsubscription to the controller, ADR G01.03 §3). A stray tap in Idle or
  // Ended dispatches nothing.
  pauseSession(): boolean {
    if (this.engineState.phase !== 'Active' && this.engineState.phase !== 'Paused') return false;
    this.dispatch({ type: 'Pause' });
    this.location.setMode('paused'); // 11 §4.2: the subscription goes with the geofences
    return true;
  }

  resumeSession(): boolean {
    if (this.engineState.phase !== 'Paused') return false; // Resume exists only from Paused (ADR G01.03 §3.3)
    this.dispatch({ type: 'Resume' });
    this.location.setMode('active-guide');
    return true;
  }

  end(): boolean {
    if (this.engineState.phase !== 'Active' && this.engineState.phase !== 'Paused') return false;
    this.dispatch({ type: 'End' });
    this.location.setMode('idle'); // 19 §4.3: End releases the GPS subscription
    // R3: End releases the session-scoped listeners (GPS sink, access). The
    // audio events stay — a surviving moment must clear the Ended mirror, and
    // a re-Start re-attaches the rest (note 8).
    this.detachSessionSubscriptions();
    return true;
  }

  // G06.04 (issue #63) — the confirmed guide switch of 11 §4.1 finishes this
  // session's durable row in ANOTHER controller's switch transaction (ADR
  // G01.03 §3.3: one UPDATE + INSERT; this engine is never told), so the
  // mirror is INJECTED as Ended — no dispatch, no onCommitted, no second
  // durable write — and the walk's resources are released here. The guide
  // launch stops (§4.3: finishing stops the guide sound); a sounding moment
  // survives, it is not the session's property (ADR G01.02 §3.8). The
  // reducer rejects everything afterward (no live session), so a late
  // AccessReady or audio callback cannot re-arm the old window. A session
  // that already ended (or an id that is not this one) is a no-op.
  retire(finishedSessionId: string): void {
    if (this.engineState.phase !== 'Active' && this.engineState.phase !== 'Paused') return;
    if (this.engineState.sessionId !== finishedSessionId) return;
    if (this.engineState.playing?.owner === 'guide') this.audio.stop();
    this.engineState = {
      ...this.engineState,
      phase: 'Ended',
      playing: null,
      queued: null,
      autoplaySuspended: true,
      focusLostAt: null,
    };
    this.location.setMode('idle');
    this.location.setGeofenceWindow([]);
    // R3: the switched-away walk releases its session-scoped listeners — the
    // new walk owns the resources from its own acceptance, never from this
    // mirror's death. (dispose() on this abandoned controller releases the
    // rest.)
    this.detachSessionSubscriptions();
  }

  // G05.05.b restart recovery (09 §9.1, ADR G01.03 §3.2): the restored
  // session is INJECTED, not dispatched — no event runs, so no effect, no
  // audio and no location arming happens here; the controller exposes the
  // state and owns the screen-level arming. The stop set is swapped to the
  // records the recovery read for the pinned version (ADR §3.4): the
  // pipeline candidates and the window geometry follow the row's package,
  // never the catalog's current one.
  restore(state: RunSessionState, stops: ReadonlyArray<RunStop>): void {
    // The restored session re-owns the resources (R3: acceptance or restore).
    this.attachResourceSubscriptions();
    this.engineState = state;
    this.stops = stops;
    this.candidates = new Map(
      stops.map((stop) => [stop.stopId, { lat: stop.lat, lng: stop.lng, radius: stop.radius }]),
    );
  }

  selectStop(stopId: string): void {
    this.dispatch({ type: 'UserSelectedStop', stopId });
  }

  selectStory(stopId: string, storyId: string): void {
    this.dispatch({ type: 'UserSelectedStory', stopId, storyId });
  }

  pauseAudio(): void {
    this.dispatch({ type: 'UserPausedAudio' });
    this.audio.pause();
  }

  stopAudio(): void {
    this.dispatch({ type: 'UserStoppedAudio' });
  }

  resumeAudio(token: { kind: 'guide' | 'moment'; ref: string; seq: number }): void {
    this.dispatch({ type: 'ResumeAudio', token });
  }

  guideResume(): void {
    this.dispatch({ type: 'GuideResume' });
  }

  // G07.03: the live session's moment entry (the sessionMoment port). The
  // caller that resolved the teaser fact carries its store-relative path —
  // without it the launch goes out with the empty path of the G05.03.a
  // boundary, so a real adapter fails it (story_play_failed suspends
  // automation) — the safe failure, never a silently successful fake. The
  // boolean is the port's acceptance fact: true iff the engine took the
  // player for exactly this minted launch (ADR G01.02 §3.4).
  playMoment(momentId: string, storyId: string, path?: string): boolean {
    const seq = this.nextMomentSeq();
    this.pendingMomentPath = path === undefined ? null : { seq, path };
    this.dispatch({
      type: 'PlayMoment',
      momentId,
      storyId,
      token: { kind: 'moment', ref: momentId, seq },
    });
    this.pendingMomentPath = null;
    const state = this.engineState;
    return (
      (state.phase === 'Active' || state.phase === 'Paused') &&
      state.playing !== null &&
      state.playing.owner === 'moment' &&
      state.playing.seq === seq
    );
  }

  // The physical channel: raw fixes run the pipeline; only accepted events
  // (LocationAccepted, then the DwellCompleted batch) enter the engine.
  private onFix(fix: FixInput): void {
    const result = acceptFix(this.pipelineState, fix, this.candidates, this.clock.now(), this.pipelineConfig);
    if (!result.accepted) return;
    this.pipelineState = result.state;
    for (const event of result.events) this.dispatch(event);
  }

  // The physical channel: tagged audio callbacks map onto the engine's event
  // names. The guide token IS the accepted (session_id, play_id) pair
  // (ADR G01.02 §3.2), so `finished` unpacks it verbatim; a moment launch's
  // finish is the engine's MomentFinished — dispatching AudioFinished for it
  // would be rejected by the owner rules and leave a dead launch in the
  // mirror, silencing the guide automation until a manual tap.
  private onAudioEvent(event: AudioServiceEvent): void {
    switch (event.type) {
      case 'finished':
        if (event.token.kind === 'moment') {
          // The event's storyId is payload the engine's rejection rule never
          // reads; the mirror supplies it when the launch is still there.
          const session = this.engineState;
          const storyId =
            session.phase !== 'Idle' && session.playing?.owner === 'moment' ? session.playing.storyId : '';
          this.dispatch({
            type: 'MomentFinished',
            token: event.token,
            momentId: event.token.ref,
            storyId,
          });
          return;
        }
        this.dispatch({ type: 'AudioFinished', sessionId: event.token.ref, playId: event.token.seq });
        return;
      case 'story_play_failed':
        this.dispatch({ type: 'AudioFailed', token: event.token, reason: event.reason });
        return;
      case 'FocusLoss':
        this.dispatch({ type: 'FocusLoss' });
        return;
      case 'FocusRegain':
        this.dispatch({ type: 'FocusRegain' });
        return;
      case 'paused':
      case 'resumed':
        return; // echo of this orchestrator's own command — see header note 1
    }
  }

  // The one input path (R2, G20.03): the durability point receives step()'s
  // proposed state BEFORE anything commits — the durable write, then the
  // state (header note 7: the checkpoints and the play_seq write-through of
  // ADR G01.03 §3.1/§3.3 happen here), then the proposed effects. A durable
  // write that refuses aborts the transition whole: the engine memory keeps
  // the last durable state (failTransition's posture), no effect fires and
  // the original error surfaces to the dispatch caller — the screens never
  // advertise a transition the row does not hold, and the retry
  // re-dispatches it against the row.
  private dispatch(event: RunEvent): void {
    const before = this.engineState;
    const result = step(this.engineState, event, this.clock.now(), this.engineConfig);
    try {
      this.onCommitted?.(before, result.state);
    } catch (error) {
      this.failTransition(event, result.commands, before);
      throw error;
    }
    this.engineState = result.state;
    this.applyEffects(result.commands);
  }

  // The refused-commit posture of a failed session Pause or End (R2, G20.03):
  // the memory state stays the durable one — plus the automation suspension,
  // so the next sound never starts by itself after the failed write (11
  // §5.1.1 outcome 2) — and the physical guide sound still stops: the
  // proposed StopAudio is the only effect that runs, because the guide launch
  // is the session's property even though the row keeps its previous state.
  // A sounding moment is not session property: its stop is not proposed and
  // not applied here. The retry re-dispatches the transition from this state.
  private failTransition(event: RunEvent, commands: ReadonlyArray<RunCommand>, before: RunState): void {
    if (event.type !== 'Pause' && event.type !== 'End') return;
    if (before.phase === 'Idle') return;
    for (const command of commands) {
      if (command.type === 'StopAudio') this.audio.stop();
    }
    this.engineState = { ...before, autoplaySuspended: true };
  }

  private applyEffects(commands: ReadonlyArray<RunCommand>): void {
    for (const command of commands) {
      switch (command.type) {
        case 'PlayStory':
          void this.audio.play({ token: command.token, path: command.path });
          break;
        case 'PlayMoment': {
          // The moment path is a content-resolution concern (G05.05): the
          // caller that resolved the teaser fact carries it through the
          // session routing (G07.03). Without a resolved path the launch
          // goes out with the empty path, so a real adapter fails it
          // (story_play_failed suspends automation) — the safe failure,
          // never a silently successful fake.
          const pending = this.pendingMomentPath;
          const carried =
            pending !== null && pending.seq === command.token.seq ? pending.path : '';
          void this.audio.play({ token: command.token, path: command.path ?? carried });
          break;
        }
        case 'StopAudio':
          this.audio.stop();
          break;
        case 'PauseAudio':
          this.audio.pause();
          break;
        case 'ResumeAudio':
          this.audio.resume(command.token); // a refused token is a service no-op
          break;
        case 'SetGeofenceWindow': {
          const wanted = new Set(command.stopIds);
          this.location.setGeofenceWindow(this.stops.filter((stop) => wanted.has(stop.stopId)));
          break;
        }
        case 'ClearGeofences':
          this.location.setGeofenceWindow([]); // an empty array is ClearGeofences (services/location)
          break;
        case 'ScheduleTimer':
        case 'CancelTimer':
        case 'PersistProgress':
        case 'EmitEvent':
        case 'ShowArrivalCard':
          break; // G05.05: persistence, telemetry and UI surface — see header note 6
        default: {
          // The compile-visible guard note 6 promises: a new RunCommand variant
          // must be decided here, not silently dropped.
          const unhandled: never = command;
          throw new Error(`unhandled run command: ${JSON.stringify(unhandled)}`);
        }
      }
    }
  }

  private session(): Exclude<RunState, { phase: 'Idle' }> {
    if (this.engineState.phase === 'Idle') throw new Error('no live session before Start');
    return this.engineState;
  }
}

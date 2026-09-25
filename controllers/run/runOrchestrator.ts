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
// 1. The audio service's `paused`/`resumed` events are echoes of commands this
//    orchestrator itself issued (pause()/resume()): the engine state already
//    committed at the intent (UserPausedAudio/ResumeAudio), so the echo is
//    never dispatched — a second dispatch would double-apply the transition.
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
//    the engine validates the echo) with a process-wide monotonic seq.
// 6. Commands with no consumer in this layer (ScheduleTimer, CancelTimer,
//    PersistProgress, EmitEvent, ShowArrivalCard) are G05.05's persistence,
//    telemetry and UI surface — deliberately dropped here, not silently lost:
//    the exhaustive switch makes adding a command a compile-visible decision.
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
import { initialRunState, type RunState, type Tier } from '../../core/engine/state.ts';
import type { LocationService } from '../../services/location/service.ts';
import type { GeofenceStop } from '../../services/location/types.ts';
import type { AudioService } from '../../services/audio/service.ts';
import type { AudioServiceEvent } from '../../services/audio/types.ts';

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
}

export class RunOrchestrator {
  private readonly location: LocationService;
  private readonly audio: AudioService;
  private readonly clock: RunClock;
  private readonly engineConfig: EngineConfig;
  private readonly pipelineConfig: PipelineConfig;
  private readonly route: RunRoute;
  private readonly stops: ReadonlyArray<RunStop>;
  private readonly candidates: ReadonlyMap<string, PipelineCandidate>;

  private engineState: RunState = initialRunState;
  private pipelineState: PipelineState = initialPipelineState;
  private momentSeq = 0;

  constructor(deps: RunOrchestratorDeps) {
    this.location = deps.location;
    this.audio = deps.audio;
    this.clock = deps.clock;
    this.engineConfig = deps.engineConfig;
    this.pipelineConfig = deps.pipelineConfig;
    this.route = deps.route;
    this.stops = deps.stops;
    this.candidates = new Map(
      deps.stops.map((stop) => [stop.stopId, { lat: stop.lat, lng: stop.lng, radius: stop.radius }]),
    );
    deps.location.onFix((fix) => this.onFix(fix));
    deps.audio.onEvent((event) => this.onAudioEvent(event));
  }

  // Read-only engine view for the UI layer (G05.05) and the scenario tests:
  // the single owner of progress is the reducer, this only hands out its state.
  get state(): RunState {
    return this.engineState;
  }

  // 19 §4.3: the session opens, then the location arms and the window seeds.
  start(sessionId: string, accessibleStopIds?: ReadonlyArray<string>): void {
    const ids = accessibleStopIds ?? this.stops.map((stop) => stop.stopId);
    this.dispatch({
      type: 'Start',
      sessionId,
      routeId: this.route.routeId,
      version: this.route.version,
      locale: this.route.locale,
      tier: this.route.tier,
      accessibleStopIds: [...ids],
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
  // and the GPS trigger share the path (09 §6.4).
  pauseSession(): void {
    this.dispatch({ type: 'Pause' });
  }

  resumeSession(): void {
    this.dispatch({ type: 'Resume' });
  }

  end(): void {
    this.dispatch({ type: 'End' });
    this.location.setMode('idle'); // 19 §4.3: End releases the GPS subscription
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

  playMoment(momentId: string, storyId: string): void {
    this.dispatch({
      type: 'PlayMoment',
      momentId,
      storyId,
      token: { kind: 'moment', ref: momentId, seq: ++this.momentSeq },
    });
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
  // (ADR G01.02 §3.2), so `finished` unpacks it verbatim.
  private onAudioEvent(event: AudioServiceEvent): void {
    switch (event.type) {
      case 'finished':
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

  // The one input path: commit the state, then apply the proposed effects.
  private dispatch(event: RunEvent): void {
    const result = step(this.engineState, event, this.clock.now(), this.engineConfig);
    this.engineState = result.state;
    this.applyEffects(result.commands);
  }

  private applyEffects(commands: ReadonlyArray<RunCommand>): void {
    for (const command of commands) {
      switch (command.type) {
        case 'PlayStory':
          void this.audio.play({ token: command.token, path: command.path });
          break;
        case 'PlayMoment':
          // The moment path is a content-resolution concern (G05.05); the
          // command carries it when the caller knows it.
          void this.audio.play({ token: command.token, path: command.path ?? '' });
          break;
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
      }
    }
  }

  private session(): Exclude<RunState, { phase: 'Idle' }> {
    if (this.engineState.phase === 'Idle') throw new Error('no live session before Start');
    return this.engineState;
  }
}

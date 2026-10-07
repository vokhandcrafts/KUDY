// G05.05.a (issue #216) — useRunController: the thin Zustand wrapper over the
// G05.04 run orchestrator and the only writer of the durable session row
// (19 §4.3 RC column; ADR G01.03 §3.1: «адзін пісьменнік — контролер сесіі»).
// services/ enters only as types and explicit ports (issue #209 AC1: the
// composition root value-imports and constructs; the ports here are the
// seams it wires — over services/db's public API, services/contentRepo's
// evaluation and services/download's route-stops parsing). Durability
// decisions, recorded once:
// 1. Start gates on G04.03 readiness for the selected tier (ADR §3.3:
//    conditions before the transaction), then inserts the row through the
//    session-store port — the INSERT plus the R07 hint carry-over are
//    services/db startSession's one transaction — and only after that commit
//    dispatches the engine's Start and lets it arm the location effects. A
//    refusal is a named reason on the result object, never a thrown error
//    (criterion 2); a failing store write keeps the original error and
//    propagates (criterion 1's injected mid-transaction failure leaves the
//    rollback to the store).
// 2. The orchestrator's onCommitted hook (its header note 7) is the
//    durability point: it receives step()'s PROPOSED state before the
//    orchestrator commits anything — the durable delta is written first, the
//    screens are published only after the write succeeded, and the effects
//    fire after that — so the play_seq of a PlayStory lands in the row before
//    the command reaches the audio service (write-through, ADR §3.1), and a
//    failed write rejects the whole transition: the engine keeps the last
//    durable state, no effect fires and the error surfaces (R2, G20.03). A
//    plain checkpoint's own rollback is safe by contract (§3.3: the next
//    checkpoint writes the newer state) — the error still surfaces, it is
//    never swallowed.
// 3. The delta is a before/after compare of the monotonic sets and play_seq:
//    a callback the reducer rejected mutates nothing, so nothing is written
//    (criterion 4's «rejected by step() writes nothing») and an unlock that
//    touches only derived state writes nothing either.
// 4. The controller reads no clock and no GPS: startedAt comes from the
//    injected clock, fixes arrive only through the location service
//    (criterion 6); session ids come from the injected newSessionId port.
// 5. G05.05.b (issue #217) adds the rest of the lifecycle. The Pause/Resume/
//    End transactions of ADR §3.3 run in the onCommitted hook — the point
//    before the orchestrator commits the proposed state and its effects — as
//    ONE store transaction each (Pause: UPDATE + the sets checkpoint; End:
//    UPDATE finished + finished_at + the final checkpoint), so a failing
//    write rejects the transition (R2, G20.03: the memory and the screens
//    keep the last durable state, the retry re-dispatches) and the rollback
//    leaves the row in its previous state. After End the controller drops
//    the row reference: the finished row is history, and no later callback,
//    fix or AccessReady writes it (criterion 6; ADR §3.1 «гісторыя ніколі не
//    перазапісваецца»).
// 6. The wakelock is the session axis of 09 §9 / 11 §6: taken after the
//    Start commit and on Resume, released on Pause and End. The screen-
//    foreground rule of 11 §6 belongs to the composition root.
// 7. Restart recovery (09 §9.1, ADR §3.2/§3.4/§3.7) is recover(): the live
//    row is read through the recovery port and INJECTED into the engine
//    without a dispatch — playing and queued are null, autoplay is
//    suspended, no audio starts, and «continue the saved walk» stays a state
//    the screens read, never an action the controller takes. The restored
//    content comes only from layers whose package identity matches the
//    row's pinned version — a newer catalog never substitutes its files
//    (ADR §3.4); the layers that do not verify now are reported on the
//    recovery state (§3.7). A restored Active row re-arms the location
//    window (09 §9.1); a paused row holds no subscription (11 §4.2) — its
//    window re-arms through the explicit Resume.
import { createControllerStore, useController, type ControllerStore } from './createControllerStore.ts';
import { RunOrchestrator, type RunClock, type RunRoute, type RunStop } from './run/runOrchestrator.ts';
// The panel's transitions have one source (runPanel.ts) — the actions below
// adapt the flat store fields onto it and write the result back; no second
// ladder lives here.
import { panelClosed, panelOpened, panelRaised, type RunPanelPosition } from './run/runPanel.ts';
import type { SessionProgress, SessionRow, SessionStartInput } from '../services/db/types.ts';
import type { Readiness, Tier } from '../services/contentRepo/types.ts';
import type { DownloadAccessPort } from '../services/download/access.ts';
import type { AudioService } from '../services/audio/service.ts';
import type { LocationService } from '../services/location/service.ts';
import type { EngineConfig } from '../core/engine/reducer.ts';
import type { PipelineConfig } from '../core/pipeline/types.ts';
import { initialRunState, type PlayToken, type RunSessionState, type RunState } from '../core/engine/state.ts';

// The durable session row through services/db's public API (allowed outputs):
// the composition root implements the port over startSession/checkpointProgress;
// the one expected refusal — the store's one-unfinished-session rule (G04.01,
// ADR §3.1) — comes back as a named result, any other store failure throws
// and keeps its original error.
export interface RunSessionStore {
  start(input: SessionStartInput): { ok: true } | { ok: false; reason: 'live-session-exists' };
  checkpoint(sessionId: string, progress: SessionProgress): void;
  // The lifecycle transactions of ADR G01.03 §3.3, one store call each:
  // Pause carries the sets checkpoint in the same transaction, Resume is the
  // plain UPDATE, End adds finished_at and the final checkpoint. The shapes
  // mirror services/db's public API (pauseSession/resumeSession/
  // finishSession) verbatim; the composition root implements over it.
  pause(sessionId: string, progress?: SessionProgress): void;
  resume(sessionId: string): void;
  finish(sessionId: string, input: { finishedAt: number; progress?: SessionProgress }): void;
  // The confirmed switch-guide transaction (ADR §3.3 «switch-guide», 11
  // §4.1): the app's one live row (active/paused) is finished and the next
  // session's row is inserted in ONE transaction — services/db's
  // switchSession; the implementation resolves the old session id itself
  // (the app-wide live row read, G01.03 §3.1) and reports it back, so the
  // composition root can retire the surface that owned it.
  startSwitch(
    input: SessionStartInput,
    meta: { finishedAt: number },
  ): { ok: true; finishedSessionId: string } | { ok: false; reason: 'no-live-session' };
}

// 09 §9, 11 §6: the wakelock belongs to the live Active walk — Paused and
// Finished release it. The controller models the session axis; the
// screen-foreground rule is the composition root's.
export interface RunWakelock {
  acquire(): void;
  release(): void;
}

// One recorded layer of the pinned package as the recovery read it (ADR
// §3.7): 'ready' carries the layer's stop records from the pinned route
// document — the same shape Start's seed is built from; anything else is the
// named refusal, and the layer is honestly unavailable.
export type RunRecoveryLayer =
  | { tier: Tier; status: 'ready'; stops: ReadonlyArray<RunStop> }
  | { tier: Tier; status: 'incomplete' | 'needs-recovery' | 'access-locked' };

export interface RunRecoveryPayload {
  // The app-wide live row of the asked route (ADR §3.1).
  row: SessionRow;
  // The package identity the read actually served. The composition root
  // opens the stored package for the row's pinned version; the controller
  // refuses a payload whose identity does not match the row, so a newer
  // catalog never substitutes its files into the restored session (AC5,
  // ADR §3.4).
  routeId: string;
  version: string;
  layers: ReadonlyArray<RunRecoveryLayer>;
  // G21.21 (ADR G21.20 §3.4): the audio availability of the pinned version —
  // the locales whose base layer ships audio (the validator's audioFacts
  // idiom). The NULL audio_locale row reads back as a monolingual session
  // when the row's own locale is here, and as text-only with a named
  // diagnostic when it is not; a non-NULL pin must be here to survive.
  audioLocales: ReadonlyArray<string>;
  // The recorded audio layer's per-tier reads (ADR §3.7 shape) for the row's
  // audio pin — the restored audioTierAvailable grows only from the tiers
  // that verify now; empty when the row carries no pin.
  audioLayers: ReadonlyArray<RunRecoveryLayer>;
}

// The composition root's read-only restart-recovery view (09 §9.1): the live
// row of the route plus the pinned package's disk truth. null = no live row
// for the route.
export interface RunRecovery {
  read(routeId: string): Promise<RunRecoveryPayload | null>;
}

// G04.03 readiness for the selected tier (issue #60): the Start gate.
export interface RunReadiness {
  evaluate(input: { locale: string; tier: Tier; grantedTiers?: readonly Tier[] }): Promise<Readiness>;
}

// The stops of one verified layer, read from the pinned package's route.json
// (ADR §3.2) — the same document the download channel's AccessReady events
// are built from. The route id is part of the ask (G06.04: the confirmed
// switch starts ANOTHER route through the same session ports — a port that
// cannot name its route would hand the new walk a foreign stop set). null =
// the document is absent, unreadable or foreign.
export interface RunPackageStops {
  stopsOfLayer(routeId: string, tier: Tier): Promise<string[] | null>;
}

export interface RunControllerDeps {
  location: LocationService;
  audio: AudioService;
  // The same clock instance the orchestrator and the services hold; the
  // controller never reads a clock of its own (criterion 6).
  clock: RunClock;
  engineConfig: EngineConfig;
  pipelineConfig: PipelineConfig;
  route: RunRoute;
  stops: ReadonlyArray<RunStop>;
  sessionStore: RunSessionStore;
  readiness: RunReadiness;
  packageStops: RunPackageStops;
  // The capability channel of services/download; passed through to the
  // orchestrator — the only AccessReady delivery path into the engine
  // (criterion 5, ADR §3.5).
  access: DownloadAccessPort;
  // The session identity mint (ADR §3.1: UUIDv4, never reused); a port so
  // the controller stays off the platform crypto API and tests stay
  // deterministic.
  newSessionId: () => string;
  // The tier_available fact of the download channel (ADR §3.1/§3.2): layers
  // verified and granted so far. A live port — a purchase may land between
  // app open and Start.
  grantedTiers?: () => readonly Tier[];
  // The wakelock port of the live walk (09 §9, 11 §6 — see decision 6).
  wakelock: RunWakelock;
  // The restart-recovery read (09 §9.1 — see decision 7).
  recovery: RunRecovery;
  // G07.02 (ADR G01.02 §3.2/§3.8): the composition root's process-wide
  // moment counter and the idle moment controller's live launch facts —
  // threaded to the orchestrator's Start/PlayMoment (optional; a provider
  // without them keeps the pre-G07.02 own-counter behavior).
  nextMomentSeq?: () => number;
  currentMomentPlay?: () => {
    readonly momentId: string;
    readonly storyId: string;
    readonly seq: number;
    readonly paused: boolean;
  } | null;
}

// The named refusals of Start (criterion 1/2): a not-ready package maps its
// G04.03 status onto the controller's named refusal
// (incomplete → package-incomplete, needs-recovery → package-needs-recovery,
// access-locked → package-access-locked); a second Start while a session is
// active or paused is the store's one-unfinished-session rule; a confirmed
// switch whose live row vanished between the dialog and the confirm fails
// closed (the world changed under the confirmed decision — never a guess).
// G21.21 (owner edit 2, ADR G21.20): an explicitly selected audio layer that
// is not fully verified refuses Start with its own reason — the selected
// layer's readiness is required before the walk starts, the download is the
// caller's wait path, and no other language is ever substituted.
export type RunStartRefusal =
  | 'package-incomplete'
  | 'package-needs-recovery'
  | 'package-access-locked'
  | 'live-session-exists'
  | 'switch-no-live-session'
  | 'audio-layer-not-ready'
  | 'audio-locale-invalid';

export interface RunStartInput {
  // The selected tier of this walk; 'base' unless the person starts the paid
  // layer (the readiness evaluation and the verified-tier record both follow
  // it — ADR §3.1 tier, §3.6 full selected layer).
  tier?: Tier;
  // G21.21 (ADR G21.20 §3.2): the resolved audio pin of this walk. undefined
  // = the monolingual default (the audio layer is the text layer — the
  // pre-G21.21 shape); null = the text-only session (no audio ever); a
  // locale = the pinned audio layer, whose full readiness is verified before
  // Start (owner edit 2) unless it is the text locale itself (one layer).
  audioLocale?: string | null;
  // R07 carry-over (ADR §3.9): the foreground window's shown/dismissed
  // guide_ids moved into session scope inside the Start transaction.
  carryGuideHints?: string[];
  // G06.04 — the §4.1 dialog's «Завяршыць і пачаць» decision carried over
  // from the preview (NAV8): the app's one live session of ANOTHER route is
  // finished inside the same transaction that inserts this walk's row
  // (ADR §3.3 switch-guide). Without the flag a live session refuses Start
  // (one-unfinished-session rule); the flag never reaches the store for the
  // same-route handover — the preview's own entry stays the plain Start.
  confirmedSwitch?: boolean;
}

export type RunStartResult = { ok: true; sessionId: string } | { ok: false; reason: RunStartRefusal };

// G06.03 (issue #279) — the history panel's three fixed heights (11 §2):
// one surface, no navigation stack. Peek is the player bar (the session's
// anchor — it never disappears until the walk is finished), Half is the
// point's preview, Full is the open story with the transcript. The
// spelling's single home is runPanel.ts — re-exported here for the
// controller's consumers.
export type { RunPanelPosition } from './run/runPanel.ts';

export interface RunControllerState {
  // The engine's committed state, mirrored on every accepted event — the
  // single source the screens read.
  readonly run: RunState;
  // The restart-recovery view (09 §9.1): 'restored' is the «Працягнуць
  // захаваную прагулку?» state the screens read — the controller never
  // continues the walk itself (criterion 4). unavailableTiers is the §3.7
  // report: recorded layers whose pinned files do not verify now.
  readonly recovery: RunRecoveryState;
  // G06.03 — the history panel's UI state (11 §11: the panel position and
  // inspected live in the run controller, never in the engine). 'peek' is
  // the player bar — the walk's anchor that never disappears until the
  // session is finished; 'half' shows the inspected point's preview, 'full'
  // the open story with the transcript. `inspected` is whose card is open
  // (11 §3.2) — an independent pointer: opening or closing a card never
  // changes the audio owner, never counts progress (AC5), and the panel
  // actions dispatch nothing to the audio service (AC3).
  readonly panel: RunPanelPosition;
  readonly inspected: string | null;
  readonly start: (input?: RunStartInput) => Promise<RunStartResult>;
  readonly pauseSession: () => void;
  readonly resumeSession: () => void;
  readonly end: () => void;
  // G06.04 — the composition root's call when this controller's session was
  // finished by a confirmed guide switch elsewhere (11 §4.1): the engine
  // mirror becomes Ended without a dispatch (the row is already history —
  // ADR §3.3 switch-guide wrote it), the walk's resources are released, and
  // no later callback writes the finished row. A controller with no live
  // session ignores the call.
  readonly retire: () => void;
  // The restart recovery of 09 §9.1: reads the live row and exposes it as a
  // state. The composition root calls it when the run surface opens; a
  // controller that already owns a live session ignores the call.
  readonly recover: () => Promise<void>;
  readonly selectStop: (stopId: string) => void;
  readonly selectStory: (stopId: string, storyId: string) => void;
  readonly pauseAudio: () => void;
  readonly stopAudio: () => void;
  readonly resumeAudio: (token: PlayToken) => void;
  readonly guideResume: () => void;
  // G07.03: the live session's moment entry (the sessionMoment port of the
  // no-session controller). The path is the teaser fact the caller resolved;
  // the boolean is the engine's acceptance — true iff the player was taken
  // for exactly this launch (ADR G01.02 §3.4).
  readonly playMoment: (momentId: string, storyId: string, path?: string) => boolean;
  // The panel actions of G06.03 (11 §2): dismiss is always "one position
  // down" (Full → Half → Peek) and identical for the panel's ✕ and the
  // screen Back (AC1) — from Peek the Back button is navigation, the
  // screen's concern. openCard sets the inspected card and lands the panel
  // on Half; dismiss keeps `inspected` — «што апошняе адкрывалі» (11 §3.2).
  // All three are UI writes: no audio command, no engine dispatch.
  readonly openCard: (stopId: string) => void;
  readonly dismissPanel: () => void;
  readonly expandPanel: () => void;
  // The Peek bar's resume of the guide launch (11 §2: playback control
  // lives in the bar). The controller rebuilds the guide token — the
  // (session_id, play_id) pair is the token's public identity (ADR G01.02
  // §3.2) — so the UI never assembles one; a moment launch resumes through
  // its own path (G07).
  readonly resumeCurrentAudio: () => void;
}

export type RunRecoveryState =
  | { status: 'none' }
  | {
      status: 'restored';
      sessionId: string;
      unavailableTiers: Tier[];
      // G21.21 (ADR G21.20 §3.4): the restored audio pin — null = the
      // text-only session; a locale = the pin that survived (a NULL row
      // restores as the monolingual pin of its own locale when the pinned
      // version still ships that audio).
      audioPin: string | null;
      // The §3.4 diagnostic: a non-NULL row pin that the pinned version's
      // availability no longer names (a rollback, a re-published version) —
      // dropped to text-only, the session and its progress continue intact.
      droppedAudioPin: string | null;
    };

export function createRunController(deps: RunControllerDeps): ControllerStore<RunControllerState> {
  // The durable row this controller owns; null until a Start transaction
  // commits (checkpoint before that would address no row — ADR §3.1: Idle is
  // the absence of a row).
  let sessionId: string | null = null;
  let store: ControllerStore<RunControllerState> | null = null;

  const orchestrator = new RunOrchestrator({
    location: deps.location,
    audio: deps.audio,
    clock: deps.clock,
    engineConfig: deps.engineConfig,
    pipelineConfig: deps.pipelineConfig,
    route: deps.route,
    stops: deps.stops,
    access: deps.access,
    nextMomentSeq: deps.nextMomentSeq,
    currentMomentPlay: deps.currentMomentPlay,
    onCommitted: (before, after) => {
      // R2 (G20.03): proposed → durable write → publish. The durable write
      // runs first; its failure rejects the transition — the orchestrator
      // keeps the last durable state, fires no effect and rethrows — so the
      // screens never see a state the row does not hold.
      if (sessionId === null) {
        store?.setState({ run: after });
        return;
      }
      const progress = durableDelta(before, after);
      // The lifecycle transactions of ADR §3.3 (decision 5): the durable
      // write carries the delta of the same transition, so Pause and End
      // land as one store transaction each. The Start transition never
      // reaches here — start() wrote its row before the dispatch.
      if (before.phase === 'Active' && after.phase === 'Paused') {
        deps.sessionStore.pause(sessionId, progress ?? undefined);
      } else if (before.phase === 'Paused' && after.phase === 'Active') {
        deps.sessionStore.resume(sessionId);
      } else if (after.phase === 'Ended') {
        deps.sessionStore.finish(sessionId, {
          finishedAt: deps.clock.now(),
          progress: progress ?? undefined,
        });
        // The finished row is history (ADR §3.1): the controller drops the
        // reference, so no later callback, fix or AccessReady writes it
        // (criterion 6).
        sessionId = null;
      } else if (progress !== null) {
        deps.sessionStore.checkpoint(sessionId, progress);
      }
      store?.setState({ run: after });
    },
  });

  const start = async (input: RunStartInput = {}): Promise<RunStartResult> => {
    const tier = input.tier ?? 'base';
    const readiness = await deps.readiness.evaluate({
      locale: deps.route.locale,
      tier,
      grantedTiers: deps.grantedTiers?.(),
    });
    if (readiness.status !== 'ready') return { ok: false, reason: refusalOf(readiness) };
    // G21.21 (ADR G21.20 §3.2, owner edits 1–2): the resolved audio pin of
    // this walk. undefined or the text locale = the monolingual session (the
    // audio layer IS the text layer — the text evaluation already verified
    // it, the row stores NULL); null = the text-only session (row NULL, no
    // audio ever); any other locale = a separate audio layer whose full
    // readiness is verified here before Start (owner edit 2: the download is
    // the caller's wait path, never a silent substitution).
    let audio: { locale: string | null; tiers: ReadonlyArray<Tier> } | undefined;
    let rowAudioLocale: string | null = null;
    if (input.audioLocale !== undefined && input.audioLocale !== null && input.audioLocale !== deps.route.locale) {
      if (input.audioLocale.length === 0) return { ok: false, reason: 'audio-locale-invalid' };
      const audioReadiness = await deps.readiness.evaluate({
        locale: input.audioLocale,
        tier,
        grantedTiers: deps.grantedTiers?.(),
      });
      if (audioReadiness.status !== 'ready') return { ok: false, reason: 'audio-layer-not-ready' };
      audio = { locale: input.audioLocale, tiers: [...audioReadiness.tierAvailable] };
      rowAudioLocale = input.audioLocale;
    }
    const accessible = await startAccessibleStops(deps.packageStops, deps.route.routeId, readiness.tierAvailable);
    if (accessible === null) return { ok: false, reason: 'package-incomplete' };
    const id = deps.newSessionId();
    // The Start transaction (ADR §3.3): INSERT + the R07 carry-over in one
    // commit; the store decides the one-unfinished-session rule (§3.1). The
    // confirmed switch (G06.04) replaces the INSERT with §3.3's switch-guide
    // transaction — the old row's finish and this row's INSERT in one
    // commit; the engine Start below stays the transaction's Start effects.
    const startInput: SessionStartInput = {
      sessionId: id,
      routeId: deps.route.routeId,
      version: deps.route.version,
      locale: deps.route.locale,
      audioLocale: rowAudioLocale,
      tier: [...readiness.tierAvailable],
      startedAt: deps.clock.now(),
      carryGuideHints: input.carryGuideHints,
    };
    const started = input.confirmedSwitch
      ? deps.sessionStore.startSwitch(startInput, { finishedAt: deps.clock.now() })
      : deps.sessionStore.start(startInput);
    if (!started.ok) {
      return { ok: false, reason: started.reason === 'no-live-session' ? 'switch-no-live-session' : started.reason };
    }
    sessionId = id;
    // The engine's Start: the audio pin only when the caller resolved one —
    // undefined keeps the monolingual default (the pre-G21.21 shape), null
    // starts text-only, a locale pins its verified tiers (ADR G21.20 §3.2).
    orchestrator.start(id, accessible, [...readiness.tierAvailable], audio
      ? { locale: audio.locale, tiers: audio.tiers }
      : input.audioLocale === null
        ? { locale: null }
        : undefined);
    // ADR §3.3 Start effects: the wakelock is taken after the commit (11 §6).
    deps.wakelock.acquire();
    return { ok: true, sessionId: id };
  };

  // The session intents of 11 §4.2/§4.3: the orchestrator reports whether a
  // live transition happened, and only then does the controller fire its own
  // phase effect — a stray tap in Idle or Ended releases nothing.
  const pauseSession = (): void => {
    if (!orchestrator.pauseSession()) return;
    deps.wakelock.release();
  };

  const resumeSession = (): void => {
    if (!orchestrator.resumeSession()) return;
    deps.wakelock.acquire();
  };

  const end = (): void => {
    if (!orchestrator.end()) return;
    deps.wakelock.release();
  };

  // G06.04 — see RunControllerState.retire. The orchestrator injects the
  // Ended mirror and releases the location axis; the controller drops the
  // row reference (the row is history — ADR §3.1) and releases the wakelock.
  const retire = (): void => {
    if (sessionId === null) return;
    const finished = sessionId;
    sessionId = null;
    orchestrator.retire(finished);
    // The mirror the screens read is the store's, not the orchestrator's
    // private one — the injected Ended is a state, not a dispatch, so the
    // store is notified here (no onCommitted ran).
    store?.setState({ run: orchestrator.state });
    deps.wakelock.release();
  };

  // 09 §9.1: the return to the app reads the live row and exposes it as a
  // state — the controller never continues the walk itself (criterion 4).
  const recover = async (): Promise<void> => {
    if (sessionId !== null) return; // this controller already owns a live session
    const payload = await deps.recovery.read(deps.route.routeId);
    // Ownership is re-checked after the await: a Start may have committed
    // while the package read ran — that session owns the controller now —
    // and two concurrent recover() calls deduplicate here.
    if (sessionId !== null) return;
    if (!payload) return;
    const row = payload.row;
    if (row.routeId !== deps.route.routeId) return;
    if (row.state !== 'active' && row.state !== 'paused') return;
    const { state, unavailableTiers, stops, audioPin, droppedAudioPin } = restoredState(payload);
    sessionId = row.sessionId;
    orchestrator.restore(state, stops);
    store?.setState({
      run: state,
      recovery: {
        status: 'restored',
        sessionId: row.sessionId,
        unavailableTiers,
        audioPin,
        droppedAudioPin,
      },
    });
    if (state.phase === 'Active') {
      // 09 §9.1: the return re-arms the window of the live active session —
      // the set waits here, the first fresh fix ranks it. A paused row holds
      // no subscription (11 §4.2); its window re-arms through Resume. The
      // restored Active walk takes the wakelock back (11 §6: held in Active;
      // recover runs when the run surface opens).
      deps.location.setMode('active-guide');
      deps.wakelock.acquire();
      const permitted = new Set(state.accessibleStopIds);
      deps.location.setGeofenceWindow(stops.filter((stop) => permitted.has(stop.stopId)));
    }
  };

  const created = createControllerStore<RunControllerState>(() => ({
    run: initialRunState,
    recovery: { status: 'none' },
    panel: 'peek',
    inspected: null,
    start,
    pauseSession,
    resumeSession,
    end,
    retire,
    recover,
    selectStop: (stopId) => orchestrator.selectStop(stopId),
    selectStory: (stopId, storyId) => orchestrator.selectStory(stopId, storyId),
    pauseAudio: () => orchestrator.pauseAudio(),
    stopAudio: () => orchestrator.stopAudio(),
    resumeAudio: (token) => orchestrator.resumeAudio(token),
    guideResume: () => orchestrator.guideResume(),
    playMoment: (momentId, storyId, path) => orchestrator.playMoment(momentId, storyId, path),
    openCard: (stopId) => {
      const current = store?.getState();
      if (!current) return;
      const next = panelOpened({ position: current.panel, inspected: current.inspected }, stopId);
      if (next.position !== current.panel || next.inspected !== current.inspected) {
        store?.setState({ panel: next.position, inspected: next.inspected });
      }
    },
    dismissPanel: () => {
      const current = store?.getState();
      if (!current) return;
      const next = panelClosed({ position: current.panel, inspected: current.inspected });
      if (next.position !== current.panel) store?.setState({ panel: next.position });
    },
    expandPanel: () => {
      const current = store?.getState();
      if (!current) return;
      const next = panelRaised({ position: current.panel, inspected: current.inspected });
      if (next.position !== current.panel) store?.setState({ panel: next.position });
    },
    resumeCurrentAudio: () => {
      const state = store?.getState().run;
      if (!state || state.phase === 'Idle' || !state.playing) return;
      if (state.playing.owner !== 'guide') return;
      orchestrator.resumeAudio({ kind: 'guide', ref: state.sessionId, seq: state.playing.playId });
    },
  }));
  store = created;
  return created;
}

// The screen binding (19 §2.2, hooks as controllers).
export function useRunController(store: ControllerStore<RunControllerState>): RunControllerState {
  return useController(store);
}

// The durable delta of one committed event: the monotonic sets and the
// play_seq write-through (ADR §3.1). A rejected callback mutates nothing, an
// unlock touches only derived state — both compare equal and write nothing.
function durableDelta(before: RunState, after: RunState): SessionProgress | null {
  const from = durableView(before);
  const to = durableView(after);
  const progress: SessionProgress = {};
  if (!sameList(from.heard, to.heard)) progress.heard = [...to.heard];
  if (!sameList(from.autoFired, to.autoFired)) progress.autoFired = [...to.autoFired];
  if (from.playSeq !== to.playSeq) progress.playSeq = to.playSeq;
  return progress.heard === undefined && progress.autoFired === undefined && progress.playSeq === undefined
    ? null
    : progress;
}

function durableView(state: RunState): { heard: string[]; autoFired: string[]; playSeq: number } {
  return state.phase === 'Idle'
    ? { heard: [], autoFired: [], playSeq: 0 }
    : { heard: state.heard, autoFired: state.autoFired, playSeq: state.playSeq };
}

// Monotonic add-only lists (ADR §3.1): order is stable, so index equality is
// the whole comparison.
function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

// The Start seed of accessible_stop_ids (ADR §3.2 derivation): for every
// verified layer, the stops the pinned package names for it — the unlocks of
// past activations had no live session as addressee (ADR §3.5 scope (b)), so
// Start carries them in. null = the package changed under the Start (a layer
// document vanished, stopped matching or stopped parsing after readiness
// passed) — refuse instead of starting an unplayable walk.
async function startAccessibleStops(
  packageStops: RunPackageStops,
  routeId: string,
  tiers: readonly Tier[],
): Promise<string[] | null> {
  const ids = new Set<string>();
  for (const tier of tiers) {
    const stopIds = await packageStops.stopsOfLayer(routeId, tier);
    if (stopIds === null) return null;
    for (const id of stopIds) ids.add(id);
  }
  return [...ids];
}

function refusalOf(readiness: Exclude<Readiness, { status: 'ready' }>): RunStartRefusal {
  switch (readiness.status) {
    case 'incomplete':
      return 'package-incomplete';
    case 'needs-recovery':
      return 'package-needs-recovery';
    case 'access-locked':
      return 'package-access-locked';
  }
}

const isTier = (value: string): value is Tier => value === 'base' || value === 'extended';

// The restored engine state of 09 §9.1 / ADR §3.2 (criterion 4): the durable
// fields come verbatim from the row, the transient player fields take their
// restore invariants — playing and queued null, autoplay suspended, no fix —
// so nothing sounds and no trigger decides until a fresh fix and an explicit
// human action. The content derivation reads only layers whose package
// identity matches the row's pinned version (criterion 5, ADR §3.4): a
// foreign payload contributes nothing, and a recorded layer that does not
// verify now becomes the §3.7 report instead of a content swap.
//
// G21.21 (ADR G21.20 §3.4): the audio pin restores with the progress. A
// non-NULL row pin survives only when the pinned version's availability
// still names it — otherwise it drops to text-only with the named
// diagnostic, the session and its progress continue intact. A NULL row
// (every pre-G21.21 row, and the writer's shape for a monolingual session)
// reads back as the monolingual pin of the row's own locale when that audio
// exists, and as text-only when the guide ships no audio at all — both the
// byte-for-byte legacy behavior.
function restoredState(payload: RunRecoveryPayload): {
  state: RunSessionState;
  unavailableTiers: Tier[];
  stops: RunStop[];
  audioPin: string | null;
  droppedAudioPin: string | null;
} {
  const row = payload.row;
  const tiers = row.tier.filter(isTier);
  const trusted = payload.routeId === row.routeId && payload.version === row.version;
  const tierAvailable: Tier[] = [];
  const unavailableTiers: Tier[] = [];
  const stops = new Map<string, RunStop>();
  for (const tier of tiers) {
    const layer = trusted ? payload.layers.find((candidate) => candidate.tier === tier) : undefined;
    if (!layer || layer.status !== 'ready') {
      unavailableTiers.push(tier);
      continue;
    }
    tierAvailable.push(layer.tier);
    for (const stop of layer.stops) {
      if (!stops.has(stop.stopId)) stops.set(stop.stopId, stop);
    }
  }
  // The pin resolution (ADR §3.4): a NULL row starts from the monolingual
  // guess of its own locale; a recorded pin must be named by the pinned
  // version's availability. The audio layer's readiness comes from its own
  // per-tier reads — a pin whose layer verifies nothing runs text-only until
  // the layer verifies again (§3.3 row 2), a monolingual pin rides the text
  // layers (one layer, the same readiness).
  let audioPin: string | null;
  let droppedAudioPin: string | null = null;
  if (row.audioLocale === null) {
    audioPin = trusted && payload.audioLocales.includes(row.locale) ? row.locale : null;
  } else if (trusted && payload.audioLocales.includes(row.audioLocale)) {
    audioPin = row.audioLocale;
  } else {
    audioPin = null;
    droppedAudioPin = row.audioLocale;
  }
  const audioTierAvailable: Tier[] =
    audioPin === null
      ? []
      : audioPin === row.locale
        ? [...tierAvailable]
        : trusted
          ? payload.audioLayers.filter((layer) => layer.status === 'ready').map((layer) => layer.tier)
          : [];
  const state: RunSessionState = {
    phase: row.state === 'paused' ? 'Paused' : 'Active',
    sessionId: row.sessionId,
    routeId: row.routeId,
    version: row.version,
    locale: row.locale,
    audioLocale: audioPin,
    tier: [...tiers],
    stops: [...stops.values()].map(({ stopId, storyBaseId, storyExtendedId }) => ({
      stopId,
      storyBaseId,
      storyExtendedId,
    })),
    accessibleStopIds: [...stops.keys()],
    tierAvailable,
    audioTierAvailable,
    heard: [...row.heard],
    autoFired: [...row.autoFired],
    playing: null,
    queued: null,
    autoplaySuspended: true,
    lastFix: null,
    focusLostAt: null,
    playSeq: row.playSeq,
  };
  return { state, unavailableTiers, stops: [...stops.values()], audioPin, droppedAudioPin };
}

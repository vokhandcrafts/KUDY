// G07.05 (issue #284) — the R07 guide-hint controller (19 §2.2 reserves this
// module): the quiet «guide nearby» card of the open app, on the accepted
// ADR G07.04 contract. The controller owns the guide_hint_state/guide_hint_last
// records (09 §20: the write belongs to the nearby controller alone) and the
// one grouped card. It is never an audio owner (ADR G01.02 §3.1): it issues no
// audio commands, no Start, no purchase — its only outputs are the hint store
// rows, the local hint events and the card state the screens render.
//
// Location discipline (09 §20, criterion 2): the controller never arms
// anything. It reads the fixes the ONE subscription already delivers through
// LocationService.onRawFix (a read-only tap; the 19 §3.3 controller sink and
// the modes stay untouched), so there is no second GPS owner and no Run
// geofence is re-armed. In the active context it reads the accepted run state
// off the live surface's store; in the idle context the open city surface owns
// the subscription exactly as 09 §20 says.
//
// The numbers are the accepted values document (ADR G07.04 §3) injected as
// GuideHintValues — no threshold is decided here.
import { haversineMeters } from '../core/geo/haversine.ts';
import type { RunState } from '../core/engine/state.ts';
import type { AudioService } from '../services/audio/service.ts';
import type { LocationService } from '../services/location/service.ts';
import type { FixInput } from '../services/location/types.ts';
import type { CatalogService, NearbyOfferFacts } from '../services/catalog/types.ts';
import type { GuideHintValues } from '../services/config.ts';
import { createControllerStore, type ControllerStore } from './createControllerStore.ts';

// The public points the proximity runs over: one entry per point of a guide
// (a guide may appear several times — R07: «Блізкасць — да любой кропкі»).
// The composition root projects them from the public content it can read;
// a guide with no public point contributes no hint.
export interface GuideHintPoint {
  readonly guideId: string;
  readonly lat: number;
  readonly lng: number;
}

// The durable R07 limit store over services/db (zone B). The controller maps
// the context onto the scope: 'active' → session rows, 'idle' → the
// guide_hint_last cooldown; the implementation is the composition root's
// wiring over the public db API.
export interface GuideHintStore {
  readonly recordShown: (input: {
    readonly guideIds: readonly string[];
    readonly context: 'idle' | 'active';
    readonly sessionId: string | null;
    readonly at: number;
  }) => void;
  readonly recordDismissed: (input: {
    readonly guideIds: readonly string[];
    readonly context: 'idle' | 'active';
    readonly sessionId: string | null;
    readonly at: number;
  }) => void;
  // The guide_ids with a session-scope shown row (shown or dismissed) — the
  // one-show-per-session limit (R07).
  readonly sessionShown: (sessionId: string) => readonly string[];
  // The guide_ids inside the cross-opening cooldown window at nowMs —
  // ADR G07.04 §3: one foreground_cooldown_s for shown and dismissed.
  readonly cooldownBlocked: (nowMs: number, cooldownMs: number) => readonly string[];
}

// The local hint events, verbatim payload of the accepted event table
// (ADR G01.05 / contracts/events/event-table.v1.json): identifier fields
// only — no coordinates, no track, no distances, no URLs. local_recording is
// always; the consented sender is G09.02's and joins behind this seam later.
export type GuideHintEventType = 'guide_nearby_shown' | 'guide_nearby_opened' | 'guide_nearby_dismissed';

export interface GuideHintEventRecord {
  readonly type: GuideHintEventType;
  readonly suggestion_id: string;
  readonly shown_guide_ids: readonly string[];
  readonly context: 'idle' | 'active';
  readonly session_id?: string;
}

export interface GuideHintTelemetryPort {
  readonly record: (event: GuideHintEventRecord) => void;
}

// One card row: the public preview facts only (criterion 1 — the card
// proposes the guide's preview; no Start, no price, no paid content).
export interface NearbyHintGuide {
  readonly routeId: string;
  readonly title: string;
  readonly paid: boolean;
}

export type NearbyHintHiddenReason =
  | 'background'
  | 'quiet'
  | 'paused'
  | 'stale-fix'
  | 'dwell'
  | 'no-candidates'
  | 'limited';

export type NearbyHintState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'hidden'; readonly reason: NearbyHintHiddenReason }
  | {
      readonly kind: 'ready';
      readonly suggestionId: string;
      readonly context: 'idle' | 'active';
      readonly guides: readonly NearbyHintGuide[];
    };

// The structural slice of the live run surface's store the controller reads:
// the accepted run state and the change notifications. The composition root
// passes the runSurfaces resolver's ControllerStore<RunControllerState> —
// assignable to this shape; the tests build the minimal source directly.
export interface NearbyHintRunSource {
  readonly run: RunState;
  readonly subscribe: (listener: () => void) => () => void;
}

export interface NearbyHintDeps {
  // The ONE location service instance (19 §3.3). Used read-only: onRawFix
  // taps and nothing else — never setMode, never setGeofenceWindow.
  readonly location: LocationService;
  // The ONE audio service instance: its playback state and events are the
  // quiet gates («Пры аўдыё … не паказваецца», 11 §15).
  readonly audio: AudioService;
  // The public preview facts a hint proposes (the discovery index's guide
  // offers). A candidate without a public offer is not shown.
  readonly catalog: Pick<CatalogService, 'loadNearby'>;
  // The durable limit store (zone B) and the public points projection.
  readonly store: GuideHintStore;
  readonly points: () => readonly GuideHintPoint[];
  // The accepted contract numbers (ADR G07.04 §3).
  readonly values: GuideHintValues;
  // The one live run surface's store, or null without a live walk — the
  // root's runSurfaces resolver. Read-only: the controller starts, stops and
  // switches nothing (19 §2.2).
  readonly liveRun: () => NearbyHintRunSource | null;
  // The app-foreground fact; absent, nothing is ever shown — fail closed,
  // the idiom of every optional port (AC3: hints never render in background).
  readonly foreground?: () => boolean;
  // The commercial-dialog fact (R07 in 15 verbatim: «Падчас аўдыё, званка,
  // камерцыйнага дыялогу або ручной блакіроўкі аўтаматыкі картка не
  // паказваецца»; 11 §15 names the same pause as «аперацыі пакупкі» — the
  // gap PR #437 recorded for these cross-checks). Absent, the fact is
  // unknown and the gate stays open — no
  // surface the card mounts on hosts a commercial dialog today; the adapter
  // wires it when the commercial card lands (the `foreground` idiom, with
  // the opposite failure direction: an absent dialog fact must not kill the
  // feature).
  readonly commercialDialogUp?: () => boolean;
  readonly telemetry?: GuideHintTelemetryPort;
  readonly now?: () => number;
  readonly nextSuggestionSeq?: () => number;
}

export interface NearbyHintBinding {
  readonly store: ControllerStore<NearbyHintState>;
  // The X action: records the dismissal per presented guide_id (R07) and
  // hides the card; the limits keep re-entry from repeating it.
  readonly dismiss: () => void;
  // The tap action: records the opened event. Navigation to the preview
  // stays the screen's (expo-router) — the controller touches no route state,
  // so the Run session survives (criterion 5).
  readonly openPreview: () => void;
  // The current foreground window's shown/dismissed guide_ids — the carry
  // the Start transaction moves into session scope (ADR G01.03 §3.9).
  readonly foregroundCarry: () => string[];
}

export function createNearbyHintController(deps: NearbyHintDeps): NearbyHintBinding {
  const now = deps.now ?? (() => Date.now());
  let seqCounter = 0;
  const nextSeq = deps.nextSuggestionSeq ?? (() => ++seqCounter);
  const store = createControllerStore<NearbyHintState>(() => ({ kind: 'absent' }));

  // The guide offers loaded once per controller (the app-run surface idiom of
  // G07.01): a failed load is the honest no-previews state, not a retry loop.
  let guideOffers: ReadonlyMap<string, NearbyOfferFacts> = new Map();
  void deps.catalog
    .loadNearby(null)
    .then((loaded) => {
      if (loaded.kind !== 'ready' && loaded.kind !== 'offline') return;
      guideOffers = new Map(
        loaded.offers
          .filter((offer): offer is NearbyOfferFacts & { readonly route_id: string } =>
            offer.kind === 'guide' && offer.route_id !== null,
          )
          .map((offer) => [offer.route_id, offer]),
      );
      decide();
    })
    .catch(() => {
      /* no previews — the hints stay absent, the manual catalogue remains */
    });

  // Decision memory: the latest raw fix, the dwell anchor and the quiet
  // episode. The dwell bookkeeping runs on every qualifying fix regardless of
  // the gates — presence continued while the card was quiet, so the
  // post-audio show re-checks proximity, not the dwell.
  let lastFix: FixInput | null = null;
  let dwellAnchorAt: number | null = null;
  let lastQualifyingFixAt: number | null = null;
  let quietSince: number | null = null;
  // The presentation episode: hidden → ready mints one suggestion_id and one
  // shown event; guides joining the card later are recorded without a new
  // event (one grouped card — one shown fact, ADR G01.03 §3.9).
  let episodeKey: string | null = null;
  let suggestionId: string | null = null;
  let episodeRecorded: Set<string> = new Set();
  // The window's shown/dismissed ids — the Start carry source.
  const windowShown = new Set<string>();
  // The live run store subscription is re-attached when the resolver answers
  // with a different surface; the previous one is released, not leaked.
  let subscribedRun: NearbyHintRunSource | null = null;
  let unsubscribeRun: (() => void) | null = null;

  const hidden = (reason: NearbyHintHiddenReason): void => {
    const state = store.getState();
    if (state.kind !== 'hidden' || state.reason !== reason) {
      store.setState({ kind: 'hidden', reason });
    }
    episodeKey = null;
    suggestionId = null;
    episodeRecorded = new Set();
  };

  // The dwell continuity (ADR G07.04 §4): the anchor is the first qualifying
  // fix after the candidates were empty or the fix stream went stale; fixes
  // inside the freshness window keep it.
  const bookkeep = (fix: FixInput, at: number): void => {
    const freshnessMs = deps.values.fix_freshness_s * 1000;
    const qualifies =
      Number.isFinite(fix.lat) &&
      Number.isFinite(fix.lng) &&
      Number.isFinite(fix.accuracy) &&
      at - fix.at <= freshnessMs &&
      fix.accuracy <= deps.values.accepted_accuracy_m;
    if (!qualifies) return;
    if (dwellAnchorAt === null || lastQualifyingFixAt === null || fix.at - lastQualifyingFixAt > freshnessMs) {
      dwellAnchorAt = fix.at;
    }
    lastQualifyingFixAt = fix.at;
  };

  // The durable limit store's failure policy: a transient sqlite failure must
  // never propagate into the fix pipeline this controller observes (decide()
  // runs inside the location service's port-event dispatch — a thrown DbError
  // would skip the window recompute and the later observers). The controller
  // degrades fail-closed — the card hides and stays hidden — while the named
  // DbError rule stays the store's own diagnostic surface.
  let storeHealth: 'ok' | 'failed' = 'ok';

  const present = (next: {
    readonly context: 'idle' | 'active';
    readonly sessionId: string | null;
    readonly guides: readonly NearbyHintGuide[];
  }): void => {
    const key = `${next.context}|${next.sessionId ?? '-'}`;
    const ids = next.guides.map((guide) => guide.routeId);
    if (episodeKey !== key) {
      // New episode: mint, record the shown rows and the one shown event.
      episodeKey = key;
      suggestionId = `hint-${String(nextSeq())}`;
      episodeRecorded = new Set(ids);
      try {
        deps.store.recordShown({ guideIds: ids, context: next.context, sessionId: next.sessionId, at: now() });
      } catch {
        storeHealth = 'failed';
        hidden('limited');
        return;
      }
      for (const id of ids) windowShown.add(id);
      deps.telemetry?.record({
        type: 'guide_nearby_shown',
        suggestion_id: suggestionId,
        shown_guide_ids: ids,
        context: next.context,
        ...(next.sessionId !== null ? { session_id: next.sessionId } : {}),
      });
    } else {
      // A guide joined the card: its limit row is recorded, the episode's
      // suggestion_id and the already-sent shown event stay.
      const joined = ids.filter((id) => !episodeRecorded.has(id));
      if (joined.length > 0) {
        try {
          deps.store.recordShown({ guideIds: joined, context: next.context, sessionId: next.sessionId, at: now() });
        } catch {
          storeHealth = 'failed';
          hidden('limited');
          return;
        }
        for (const id of joined) episodeRecorded.add(id);
        for (const id of joined) windowShown.add(id);
      }
    }
    const current = store.getState();
    if (current.kind !== 'ready' || current.suggestionId !== suggestionId || current.context !== next.context) {
      store.setState({ kind: 'ready', suggestionId: suggestionId ?? '', context: next.context, guides: next.guides });
    } else if (
      current.guides.length !== next.guides.length ||
      current.guides.some((guide, index) => guide.routeId !== next.guides[index].routeId)
    ) {
      store.setState({ ...current, guides: next.guides });
    }
  };

  const decide = (): void => {
    const at = now();
    const runStore = deps.liveRun();
    if (runStore !== subscribedRun) {
      unsubscribeRun?.();
      subscribedRun = runStore;
      unsubscribeRun = runStore ? runStore.subscribe(() => decide()) : null;
    }
    const run: RunState = runStore ? runStore.run : { phase: 'Idle' };
    const sessionId = run.phase === 'Active' || run.phase === 'Paused' ? run.sessionId : null;
    const context: 'idle' | 'active' = run.phase === 'Active' ? 'active' : 'idle';

    // AC3 — background: without the foreground fact nothing is ever shown.
    if (!deps.foreground || !deps.foreground()) {
      hidden('background');
      return;
    }
    // AC3 — Paused: hints are off entirely; the paused GPS is never re-armed.
    if (run.phase === 'Paused') {
      hidden('paused');
      return;
    }
    // The quiet gates (11 §15): audio, manual block of the automation,
    // FocusLoss. A quiet episode stamps its start — the pre-quiet fix is the
    // old GPS callback the presentation must not execute (R07).
    const playback = deps.audio.playbackState();
    const quiet =
      (run.phase === 'Active' && (run.autoplaySuspended || run.focusLostAt !== null || run.playing !== null)) ||
      playback.kind === 'playing' ||
      playback.kind === 'paused' ||
      deps.commercialDialogUp?.() === true;
    if (quiet) {
      quietSince = quietSince ?? at;
      hidden('quiet');
      return;
    }

    // The fix quality gates (ADR G07.04 §3/§4): age ≤ fix_freshness_s and
    // accuracy ≤ accepted_accuracy_m; the dwell bookkeeping has kept the
    // anchor through the quiet episode.
    const fix = lastFix;
    const freshnessMs = deps.values.fix_freshness_s * 1000;
    const fixQualifies =
      fix !== null &&
      Number.isFinite(fix.lat) &&
      Number.isFinite(fix.lng) &&
      Number.isFinite(fix.accuracy) &&
      at - fix.at <= freshnessMs &&
      fix.accuracy <= deps.values.accepted_accuracy_m;
    if (fix === null || !fixQualifies) {
      hidden('stale-fix');
      return;
    }
    // A post-quiet presentation needs a fix newer than the quiet episode.
    if (quietSince !== null && fix.at <= quietSince) {
      hidden('stale-fix');
      return;
    }
    quietSince = null;

    // The candidates: any public point of a guide inside the one proximity
    // radius (R07), with a public preview offer, not blocked by the limits
    // and — in the active context — never the selected guide itself. The
    // cooldown set guards both contexts: one outing must not re-introduce a
    // guide a recent window already presented (ADR G07.04 §3 intent).
    const presenting = episodeKey !== null ? episodeRecorded : new Set<string>();
    let cooldown: readonly string[];
    let sessionRows: readonly string[];
    try {
      cooldown = deps.store.cooldownBlocked(at, deps.values.foreground_cooldown_s * 1000);
      sessionRows = sessionId !== null ? deps.store.sessionShown(sessionId) : [];
    } catch {
      // The limits are unreadable — fail closed (the comment at storeHealth).
      storeHealth = 'failed';
      hidden('limited');
      return;
    }
    if (storeHealth === 'failed') {
      hidden('limited');
      return;
    }
    const blocked = new Set<string>([...cooldown, ...sessionRows]);
    const inRadius = new Map<string, boolean>();
    for (const point of deps.points()) {
      if (
        !Number.isFinite(point.lat) ||
        !Number.isFinite(point.lng) ||
        inRadius.has(point.guideId) ||
        haversineMeters(fix.lat, fix.lng, point.lat, point.lng) > deps.values.proximity_radius_m
      ) {
        continue;
      }
      inRadius.set(point.guideId, true);
    }
    const candidates: NearbyHintGuide[] = [];
    for (const guideId of inRadius.keys()) {
      if (blocked.has(guideId) && !presenting.has(guideId)) continue;
      if (run.phase === 'Active' && run.routeId === guideId) continue;
      const offer = guideOffers.get(guideId);
      // A guide whose public projection carries no title has no honest card
      // row to render — it is not a candidate.
      if (!offer || offer.title === null) continue;
      candidates.push({
        routeId: guideId,
        title: offer.title,
        paid: offer.access === 'paid' || offer.access === 'mixed',
      });
    }
    candidates.sort((a, b) => (a.routeId < b.routeId ? -1 : a.routeId > b.routeId ? 1 : 0));
    if (candidates.length === 0) {
      // Departure: the presence broke — the dwell anchor restarts on the next
      // arrival (N4: a departed card never comes back from its old fix).
      dwellAnchorAt = null;
      hidden(inRadius.size > 0 ? 'limited' : 'no-candidates');
      return;
    }

    if (dwellAnchorAt === null || at - dwellAnchorAt < deps.values.dwell_s * 1000) {
      hidden('dwell');
      return;
    }
    present({ context, sessionId, guides: candidates });
  };

  // The raw-fix tap and the audio events are the re-decision triggers; the
  // live run store's own notifications join through the subscription above.
  deps.location.onRawFix((fix) => {
    lastFix = fix;
    bookkeep(fix, now());
    decide();
  });
  deps.audio.onEvent(() => decide());

  const currentSessionId = (): string | null => {
    const run = deps.liveRun()?.run;
    return run !== undefined && (run.phase === 'Active' || run.phase === 'Paused') ? run.sessionId : null;
  };

  return {
    store,
    dismiss: () => {
      const state = store.getState();
      if (state.kind !== 'ready') return;
      const ids = state.guides.map((guide) => guide.routeId);
      const sessionId = state.context === 'active' ? currentSessionId() : null;
      try {
        deps.store.recordDismissed({ guideIds: ids, context: state.context, sessionId, at: now() });
      } catch {
        // The durable dismissal failed — the limits cannot be trusted, so
        // the card hides fail-closed and no dismissed event is sent.
        storeHealth = 'failed';
        hidden('limited');
        return;
      }
      for (const id of ids) windowShown.add(id);
      deps.telemetry?.record({
        type: 'guide_nearby_dismissed',
        suggestion_id: state.suggestionId,
        shown_guide_ids: ids,
        context: state.context,
        ...(sessionId !== null ? { session_id: sessionId } : {}),
      });
      // The episode ends with its dismissal: the re-decision below must see
      // the presented guides as limit-blocked, not as its own card.
      episodeKey = null;
      suggestionId = null;
      episodeRecorded = new Set();
      decide();
    },
    openPreview: () => {
      const state = store.getState();
      if (state.kind !== 'ready') return;
      const sessionId = state.context === 'active' ? currentSessionId() : null;
      deps.telemetry?.record({
        type: 'guide_nearby_opened',
        suggestion_id: state.suggestionId,
        shown_guide_ids: state.guides.map((guide) => guide.routeId),
        context: state.context,
        ...(sessionId !== null ? { session_id: sessionId } : {}),
      });
    },
    foregroundCarry: () => [...windowShown].sort(),
  };
}

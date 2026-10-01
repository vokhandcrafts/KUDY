// G09.04 — metrics labels and diagnostics over the local event log. Sources
// copied not paraphrased: `12` (лейкі: the five reading questions and their
// event chains; «session_ended азначае "чалавек скончыў гэтую прагулку", а не
// "наведаў усе кропкі"»; «Лічбы паказваюцца разам з колькасцю назіраў»; absence
// of an event never explains a cause — the person could be offline or have
// declined analytics), the event table
// contracts/events/event-table.v1.json (the closed event-name vocabulary this
// module partitions — no invented names, implementation-rules 2) and the
// issue #294 criteria. Ownership: this module owns the label vocabulary
// (categories, funnel readings, failure labels, the mixing guard) and the
// diagnostics report — counts per label, never summed across categories; the
// SQL stays in services/db (ADR G01.03 §3.3, new listEvents read) and the
// consent semantics stay in services/analytics (getAnalyticsConsent is the
// single durable source).
//
// Reading notes the report encodes structurally: a partial walk is never a
// failure — `failures` counts only the explicit failure labels
// (`*_failed`, `autotriggers_unavailable`), a funnel step with no
// observations is a zero, not a drop-off verdict; offline and analytics
// refusal are data boundaries (consent state, pending tail, the last
// acknowledged moment — where server visibility ends), and the sample
// incompleteness is explicit as the weakened-source share.
import { getAnalyticsConsent } from './analytics.ts';
import { listEvents } from './db/db.ts';
import type { SqlDriver } from './db/types.ts';

// Closed category vocabulary: every event-table type belongs to exactly one
// category, so a count is always readable as its own лейка («12»: адрозніваць
// выбар, загрузку, старт; камерцыйнае не змешваецца з прагулкай; discovery —
// асобна ад ацэнак). Names verbatim from the table; the test suite checks the
// partition against the canonical JSON (one category each, none missing,
// none invented).
export type EventCategory = 'walk' | 'commerce' | 'discovery' | 'hints' | 'app';

export const CATEGORY_EVENTS: Readonly<Record<EventCategory, readonly string[]>> = {
  // The walk itself: preview, sessions, stops and story plays (`09` §10; `12`
  // rows «падрыхтаваць прагулку», «ці чалавек слухае», «ці зручна вяртацца»).
  walk: [
    'route_preview',
    'stop_reached',
    'session_started',
    'session_resumed',
    'session_paused',
    'session_ended',
    'story_play_started',
    'story_play_failed',
    'story_audio_completed',
  ],
  // The purchase and download chain (`12` row «ці працуе пакупка»: куплена і
  // гатова да прайгравання — розныя вынікі).
  commerce: [
    'extension_offer_shown',
    'extension_offer_accepted',
    'purchase_started',
    'purchase_succeeded',
    'purchase_failed',
    'download_started',
    'download_completed',
    'download_failed',
  ],
  // Discovery offers — never joined with feedback ratings (`12`
  // «непублічныя водгукі»: водгукі і events маюць розную паўнату/аўдыторыю).
  discovery: ['discovery_offer_shown', 'discovery_offer_opened'],
  // Guide hints beside the walker (`12` «падказкі пра гіды побач»; R07).
  hints: ['guide_nearby_shown', 'guide_nearby_opened', 'guide_nearby_dismissed'],
  // App-surface events without a walk (`09` §10).
  app: [
    'app_open',
    'explore_option_tap',
    'moment_shown',
    'moment_opened',
    'moment_dismissed',
    'location_stalled',
    'autotriggers_unavailable',
  ],
};

// The event-type → category lookup. An unknown type is not a crash and not a
// guess: it returns null and the report lists it under unknown_types —
// diagnostics degrade visibly, never silently (implementation-rules 14).
export function categoryOf(type: string): EventCategory | null {
  for (const [category, types] of Object.entries(CATEGORY_EVENTS)) {
    if ((types as readonly string[]).includes(type)) return category as EventCategory;
  }
  return null;
}

// The reading chains («лейкі») verbatim from `12` — each row's event sequence
// (technical_failures is `12`'s fault row: the labels that ARE failures).
// Chains may cross categories where the canon reads them together
// (walk_preparation downloads; guide_hints continues into the walk), so a
// label set is well-formed when it sits inside one category or inside one
// chain — that is exactly the mix guard below.
export type FunnelId =
  | 'walk_preparation'
  | 'listening'
  | 'returning'
  | 'purchase'
  | 'technical_failures'
  | 'guide_hints'
  | 'discovery';

export const LABEL_FUNNELS: Readonly<Record<FunnelId, readonly string[]>> = {
  // `12`: route_preview → download_started → download_completed →
  // session_started («у паўторнай прагулкі загрузкі можа не быць»).
  walk_preparation: ['route_preview', 'download_started', 'download_completed', 'session_started'],
  // `12`: session_started → story_play_started → story_audio_completed.
  listening: ['session_started', 'story_play_started', 'story_audio_completed'],
  // `12`: session_paused → session_resumed → session_ended («паўза —
  // нармальная частка прагулкі»).
  returning: ['session_paused', 'session_resumed', 'session_ended'],
  // `12`: extension_offer_shown → … → purchase_succeeded → download_completed.
  purchase: [
    'extension_offer_shown',
    'extension_offer_accepted',
    'purchase_started',
    'purchase_succeeded',
    'download_completed',
  ],
  // `12`: «Дзе тэхнічны збой?» — фіксаваць прычыну, не запісваць адмову ад
  // прапановы як памылку. story_play_failed joins by its table anchor
  // (group signature story_play_started/story_play_failed, reason required).
  technical_failures: ['purchase_failed', 'download_failed', 'autotriggers_unavailable'],
  // `12` «падказкі пра гіды побач»: guide_nearby_shown → guide_nearby_opened
  // → route_preview → session_started (joined by suggestion_id when the
  // transition came from a hint).
  guide_hints: ['guide_nearby_shown', 'guide_nearby_opened', 'route_preview', 'session_started'],
  // `12` «непублічныя водгукі»: discovery_offer_shown →
  // discovery_offer_opened (→ route_preview, калі вынік — гід).
  discovery: ['discovery_offer_shown', 'discovery_offer_opened'],
};

// The labels the report may count as failures: the explicit fault names
// only. Nothing else — and above all no missing funnel step — can produce a
// failure here (criterion 2: a partial walk is a finished walk, `12`).
export const FAILURE_LABELS: readonly string[] = [
  'purchase_failed',
  'download_failed',
  'story_play_failed',
  'autotriggers_unavailable',
];

export class MetricsError extends Error {
  rule: 'invalid_window' | 'invalid_event_row' | 'unknown_label' | 'label_mix';

  constructor(rule: MetricsError['rule'], message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MetricsError';
    this.rule = rule;
  }
}

// The mix guard (criterion 1, the map/revert-able check): a derived view over
// labels is well-formed only when it stays inside one category or inside one
// declared reading chain. A set that spans categories without a chain that
// reads them together («route_preview» + «purchase_started» as one лейка) is
// refused with a named diagnostic instead of producing a merged number.
export function assertNoCategoryMix(labels: readonly string[]): void {
  const known = new Set<string>();
  for (const types of Object.values(CATEGORY_EVENTS)) {
    for (const type of types) known.add(type);
  }
  for (const label of labels) {
    if (!known.has(label)) {
      throw new MetricsError('unknown_label', `label ${label} is not in the event table vocabulary`);
    }
  }
  const categories = new Set(labels.map((label) => categoryOf(label)));
  if (categories.size <= 1) return;
  for (const steps of Object.values(LABEL_FUNNELS)) {
    if (labels.every((label) => (steps as readonly string[]).includes(label))) return;
  }
  throw new MetricsError(
    'label_mix',
    `labels ${labels.join(', ')} span categories ${[...categories].join(', ')} without a reading chain that joins them`,
  );
}

export interface MetricsReportWindow {
  /** Inclusive lower bound on the event `at` (epoch ms). */
  from?: number;
  /** Inclusive upper bound on the event `at` (epoch ms). */
  to?: number;
}

export interface MetricsReport {
  window: { from: number | null; to: number | null };
  // Counts carry their observation basis (`12`: «лічбы паказваюцца разам з
  // колькасцю назіраў»); there is deliberately no cross-category total here.
  labels: Array<{ type: string; category: EventCategory | null; count: number }>;
  readings: Array<{ funnel: FunnelId; steps: Array<{ type: string; count: number }>; observations: number }>;
  failures: Array<{ type: string; count: number }>;
  unknown_types: string[];
  // Data boundaries (`12`: absence of an event never explains a cause —
  // offline or declined analytics; criterion 3).
  boundaries: {
    analytics_consent: 'granted' | 'revoked' | 'never_asked';
    future_sends_blocked: boolean;
    /** Latest acknowledged (sent) event time within the window; null = no acknowledged row in the window. */
    server_visibility_ends_at: number | null;
    /** Recorded but not yet acknowledged — the offline/pending trace. */
    pending_events: number;
  };
  // Sample incompleteness is explicit (criterion 5): the share of recorded
  // observations whose server visibility is not established (pending tail,
  // or everything when consent keeps sending off). An empty sample is fully
  // weakened: nothing is observable server-side.
  sample: {
    events_total: number;
    server_visible_events: number;
    weakened_share: number;
  };
}

// Builds the diagnostics report over the local event log (sent and pending
// rows alike — the sent flag is the server-visibility trace). Works without
// analytics consent by construction: it reads the always-recorded local log,
// so a refusal shrinks the server sample, not the diagnostics.
export function buildMetricsReport(driver: SqlDriver, window: MetricsReportWindow = {}): MetricsReport {
  const { from, to } = window;
  for (const [name, value] of [
    ['from', from],
    ['to', to],
  ] as const) {
    if (value !== undefined && !Number.isFinite(value)) {
      throw new MetricsError('invalid_window', `window.${name} must be a finite epoch ms number`);
    }
  }
  if (from !== undefined && to !== undefined && from > to) {
    throw new MetricsError('invalid_window', `window.from (${from}) is after window.to (${to})`);
  }

  const rows = listEvents(driver, { from, to });
  const counts = new Map<string, number>();
  let visible = 0;
  let visibilityEndsAt: number | null = null;
  let pending = 0;
  for (const row of rows) {
    if (!Number.isFinite(row.at)) {
      throw new MetricsError('invalid_event_row', `event ${row.eventId}: stored at is not a finite epoch ms number`);
    }
    counts.set(row.type, (counts.get(row.type) ?? 0) + 1);
    if (row.sent) {
      visible += 1;
      visibilityEndsAt = Math.max(visibilityEndsAt ?? row.at, row.at);
    } else {
      pending += 1;
    }
  }

  const labels = [...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([type, count]) => ({ type, category: categoryOf(type), count }));
  const unknown_types = labels.filter((label) => label.category === null).map((label) => label.type);

  const readings = (Object.entries(LABEL_FUNNELS) as Array<[FunnelId, readonly string[]]>).map(([funnel, steps]) => {
    const stepCounts = steps.map((type) => ({ type, count: counts.get(type) ?? 0 }));
    return { funnel, steps: stepCounts, observations: stepCounts.reduce((sum, step) => sum + step.count, 0) };
  });

  const failures = FAILURE_LABELS.filter((type) => (counts.get(type) ?? 0) > 0).map((type) => ({
    type,
    count: counts.get(type) as number,
  }));

  const consent = getAnalyticsConsent(driver);
  const eventsTotal = rows.length;
  return {
    window: { from: from ?? null, to: to ?? null },
    labels,
    readings,
    failures,
    unknown_types,
    boundaries: {
      analytics_consent: consent ?? 'never_asked',
      future_sends_blocked: consent !== 'granted',
      server_visibility_ends_at: visibilityEndsAt,
      pending_events: pending,
    },
    sample: {
      events_total: eventsTotal,
      server_visible_events: visible,
      weakened_share: eventsTotal === 0 ? 1 : (eventsTotal - visible) / eventsTotal,
    },
  };
}

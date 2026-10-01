// G09.05 — crash reporting core: the closed report shape, the separate
// consent and the consent-gated submit. Sources: issue #295 criteria 1–2,
// `09` §13 M7 (crash reporting ships from the first build), `05` разд. 17. The
// closed API list (`09` §5) has no crash endpoint, so the destination is an
// injected sink port — an external Sentry-class service composes behind it
// when an account exists (issue notes). Nothing here invents a second queue
// (G09.02 precedent): a report is built and submitted once; what happens to
// a skipped or failed report is the caller's disposition.
//
// Scrubbing boundary (criterion 1): the outgoing report is a closed field
// set — crash_id, at, schema_version, kind, fingerprint. The raw message and
// any stack text never leave this module: the fingerprint is computed by the
// injected digest over the trimmed message, so a report cannot carry
// secrets, guide content, coordinates or free text — structurally, not by a
// filter's judgement.
import { setSetting } from './db/db.ts';
import type { SqlDriver } from './db/types.ts';
import { readConsentState } from './consent.ts';

export type CrashConsent = 'granted' | 'revoked';

// A separate durable decision — its own `settings` key, following the `09`
// §10 consent precedent (asked before the first send; refusal keeps the app
// fully working). Never derived from the analytics consent (criterion 2;
// the cross tests pin the independence in both directions).
const CONSENT_KEY = 'crash_consent';

export class CrashError extends Error {
  rule: 'invalid_consent_state' | 'invalid_crash_kind' | 'sink_failed';

  constructor(rule: CrashError['rule'], message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CrashError';
    this.rule = rule;
  }
}

export function getCrashConsent(driver: SqlDriver): CrashConsent | null {
  return readConsentState(driver, CONSENT_KEY, (key, stored) =>
    new CrashError('invalid_consent_state', `settings.${key} holds an unknown value: ${stored}`),
  );
}

export function setCrashConsent(driver: SqlDriver, consent: CrashConsent): void {
  setSetting(driver, CONSENT_KEY, consent);
}

// Closed kind dictionary — crash classes, not messages. A kind outside it is
// a caller bug: a named error, not a report with an invented class.
export type CrashKind = 'js_error' | 'unhandled_rejection' | 'native_crash';
const KINDS: readonly CrashKind[] = ['js_error', 'unhandled_rejection', 'native_crash'];

// The outgoing report: the closed scrubbed shape (criterion 1). The field
// names are this PR's contract (no server counterpart exists — `09` §5).
export interface CrashReport {
  crash_id: string;
  at: string;
  schema_version: 1;
  kind: CrashKind;
  fingerprint: string;
}

export interface CrashBuildInput {
  kind: CrashKind;
  /** Raw crash text — message, stack, anything. Never leaves this module. */
  message?: string;
}

export interface CrashBuildDeps {
  /** Crash id source — the wiring decides the UUID provider. */
  makeId: () => string;
  /** Digest over the trimmed raw message — dedup without content. */
  fingerprint: (message: string) => string;
  now?: () => number;
}

export function buildCrashReport(input: CrashBuildInput, deps: CrashBuildDeps): CrashReport {
  if (!KINDS.includes(input.kind)) {
    throw new CrashError('invalid_crash_kind', `unknown crash kind: ${String(input.kind)}`);
  }
  return {
    crash_id: deps.makeId(),
    at: new Date((deps.now ?? Date.now)()).toISOString(),
    schema_version: 1,
    kind: input.kind,
    fingerprint: deps.fingerprint((input.message ?? '').trim()),
  };
}

// The destination port — one report per call, no queue behind it.
export type CrashSink = (report: CrashReport) => Promise<void>;

// Consent-gated submit — the one send entry point (the flushAnalytics
// idiom): the durable consent is read before the sink is touched, no
// in-memory second copy. Without a granted consent the sink is not called at
// all — zero work, and the caller gets `skipped` instead of a silent drop
// (nothing durable is created here either way).
export async function submitCrashReport(
  driver: SqlDriver,
  report: CrashReport,
  sink: CrashSink,
): Promise<'sent' | 'skipped'> {
  if (getCrashConsent(driver) !== 'granted') return 'skipped';
  try {
    await sink(report);
  } catch (error) {
    throw new CrashError('sink_failed', 'the crash sink rejected the report', { cause: error });
  }
  return 'sent';
}

// G09.05 — acceptance suite for services/crash (issue #295, criteria 1–2).
// Criterion 1 is structural: the report is a closed field set, the raw
// message never leaves buildCrashReport, and the scrub test plants
// secrets/guide content/coordinates in the raw text and asserts none of it
// can be found in the report. Criterion 2 is the consent separation: the
// crash consent is its own durable decision, independent of the analytics
// consent in both directions.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import {
  buildCrashReport,
  CrashError,
  getCrashConsent,
  setCrashConsent,
  submitCrashReport,
  type CrashReport,
} from './crash.ts';
import { emitEvent } from './eventLog.ts';
import { flushAnalytics, setAnalyticsConsent } from './analytics.ts';
import { getSetting, openDatabase } from './db/db.ts';
import { nodeSqliteFileDriver } from './db/test-fixture.ts';
import type { SqlDriver } from './db/types.ts';

// The report shape carries no free text, so the digest is a plain fixture
// double — node:crypto only proves the injection seam works.
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

let idSeq = 0;
const fixedDeps = {
  makeId: () => `crash-${String(++idSeq)}`,
  fingerprint: sha256,
  now: () => 1_759_324_800_000,
};

function freshStore(): SqlDriver {
  const { driver } = nodeSqliteFileDriver(':memory:');
  openDatabase(driver);
  return driver;
}

test('buildCrashReport returns the closed scrubbed shape', () => {
  const report = buildCrashReport({ kind: 'js_error', message: '  boom  ' }, fixedDeps);
  assert.deepEqual(report, {
    crash_id: 'crash-1',
    at: new Date(1_759_324_800_000).toISOString(),
    schema_version: 1,
    kind: 'js_error',
    fingerprint: sha256('boom'),
  });
});

test('criterion 1: secrets, guide content and coordinates in the raw text never reach the report', () => {
  const secret = 'device_secret_9f2c4be7a1d0483f';
  const guideLine = 'Стоп «Полацкія вароты»: сходзіць і паслухаць пра вежу';
  const coordinates = '55.1846 30.2046';
  const raw = [secret, guideLine, coordinates].join('\n');
  const report = buildCrashReport({ kind: 'js_error', message: raw }, fixedDeps);
  const asText = JSON.stringify(report);
  for (const mustBeAbsent of [secret, guideLine, coordinates, 'Полацк', 'вароты', '55.1846', '30.2046']) {
    assert.ok(!asText.includes(mustBeAbsent), `the report leaks: ${mustBeAbsent}`);
  }
  // The structural guarantee: the closed field set, nothing else.
  assert.deepEqual(Object.keys(report).sort(), ['at', 'crash_id', 'fingerprint', 'kind', 'schema_version']);
});

test('criterion 1 revert guard: the fingerprint keeps dedup without carrying the text', () => {
  const first = buildCrashReport({ kind: 'js_error', message: 'TypeError: x is not a function' }, fixedDeps);
  const again = buildCrashReport({ kind: 'js_error', message: 'TypeError: x is not a function' }, fixedDeps);
  const other = buildCrashReport({ kind: 'js_error', message: 'TypeError: y is not a function' }, fixedDeps);
  assert.equal(first.fingerprint, again.fingerprint);
  assert.notEqual(first.fingerprint, other.fingerprint);
});

test('an unknown crash kind is a named caller error, not an invented class', () => {
  assert.throws(
    () => buildCrashReport({ kind: 'mystery' as never, message: 'x' }, fixedDeps),
    (error: unknown) => error instanceof CrashError && error.rule === 'invalid_crash_kind',
  );
});

test('consent lifecycle: absent = never asked, then granted and revoked are durable', () => {
  const driver = freshStore();
  assert.equal(getCrashConsent(driver), null);
  setCrashConsent(driver, 'granted');
  assert.equal(getCrashConsent(driver), 'granted');
  setCrashConsent(driver, 'revoked');
  assert.equal(getCrashConsent(driver), 'revoked');
});

test('a corrupt consent row answers with the named diagnostic, never a silent closed gate', () => {
  const driver = freshStore();
  setSettingRow(driver, 'crash_consent', 'maybe');
  assert.throws(
    () => getCrashConsent(driver),
    (error: unknown) => error instanceof CrashError && error.rule === 'invalid_consent_state',
  );
});

test('criterion 2 gate: without a granted consent the sink is never touched', async () => {
  const driver = freshStore();
  const report = buildCrashReport({ kind: 'native_crash' }, fixedDeps);
  let calls = 0;
  const sink = async (): Promise<void> => {
    calls += 1;
  };
  assert.equal(await submitCrashReport(driver, report, sink), 'skipped');
  setCrashConsent(driver, 'revoked');
  assert.equal(await submitCrashReport(driver, report, sink), 'skipped');
  assert.equal(calls, 0);
});

test('a granted consent submits the exact report once', async () => {
  const driver = freshStore();
  setCrashConsent(driver, 'granted');
  const report = buildCrashReport({ kind: 'unhandled_rejection', message: 'p' }, fixedDeps);
  const seen: CrashReport[] = [];
  const outcome = await submitCrashReport(driver, report, async (incoming) => {
    seen.push(incoming);
  });
  assert.equal(outcome, 'sent');
  assert.deepEqual(seen, [report]);
});

test('a rejecting sink surfaces sink_failed and preserves the cause', async () => {
  const driver = freshStore();
  setCrashConsent(driver, 'granted');
  const report = buildCrashReport({ kind: 'js_error' }, fixedDeps);
  const cause = new Error('sink offline');
  await assert.rejects(
    submitCrashReport(driver, report, async () => {
      throw cause;
    }),
    (error: unknown) =>
      error instanceof CrashError &&
      error.rule === 'sink_failed' &&
      (error.cause as Error | undefined)?.message === 'sink offline',
  );
});

test('criterion 2: the analytics consent never opens the crash gate', async () => {
  const driver = freshStore();
  setAnalyticsConsent(driver, 'granted');
  assert.equal(getCrashConsent(driver), null, 'crash consent must be its own decision');
  const report = buildCrashReport({ kind: 'js_error' }, fixedDeps);
  let calls = 0;
  const outcome = await submitCrashReport(driver, report, async () => {
    calls += 1;
  });
  assert.equal(outcome, 'skipped');
  assert.equal(calls, 0);
});

test('criterion 2: the crash consent never opens the analytics gate', async () => {
  const driver = freshStore();
  setCrashConsent(driver, 'granted');
  setAnalyticsConsent(driver, 'revoked');
  emitEvent(driver, {
    eventId: 'e1c90b34-6f2a-4d8e-9b31-0a55f10c2b77',
    type: 'app_open',
    at: 1_759_324_800_000,
    schemaVersion: 1,
    payload: '{}',
  });
  let sends = 0;
  const sender = async (): Promise<void> => {
    sends += 1;
  };
  assert.equal(await flushAnalytics(driver, sender), 0);
  assert.equal(sends, 0, 'a granted crash consent must not unlock the analytics flush');
});

test('criterion 2: each decision writes only its own settings row', () => {
  const driver = freshStore();
  setCrashConsent(driver, 'granted');
  assert.equal(getSetting(driver, 'analytics_consent'), null);
  setAnalyticsConsent(driver, 'granted');
  assert.equal(getSetting(driver, 'crash_consent'), 'granted', 'the analytics write must not touch the crash row');
});

function setSettingRow(driver: SqlDriver, key: string, value: string): void {
  driver.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

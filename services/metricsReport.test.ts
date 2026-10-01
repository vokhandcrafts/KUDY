// G09.04 — acceptance suite for services/metricsReport (issue #294). Criteria:
// 1. labels distinguish preview/start/play/end from purchase/download/unlock
//    without mixing (the mix guard fails a two-category merge — fails when
//    the guard is reverted to a pass-through);
// 2. a partial walk is never called a failure — only the explicit failure
//    labels land in `failures`, a missed funnel step stays a zero;
// 3. offline and analytics refusal are shown as data boundaries (consent
//    state, pending tail, where server visibility ends);
// 4. discovery shown/opened stay separate from ratings/stars (a rating-like
//    type is unknown, never a discovery count);
// 5. sample incompleteness is explicit (weakened-source share, empty sample
//    included).
// Plus the rule-2 guard: the label registry partitions the canonical event
// table exactly — none missing, none invented, one category each.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { setAnalyticsConsent } from './analytics.ts';
import { markEventsSent } from './db/db.ts';
import type { SqlDriver } from './db/types.ts';
import { eventFactory, openFreshEventStore } from './eventLog-test-fixture.ts';
import { emitEvent } from './eventLog.ts';
import {
  assertNoCategoryMix,
  buildMetricsReport,
  CATEGORY_EVENTS,
  categoryOf,
  FAILURE_LABELS,
  LABEL_FUNNELS,
  MetricsError,
} from './metricsReport.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TABLE = JSON.parse(
  fs.readFileSync(path.resolve(HERE, '..', 'contracts', 'events', 'event-table.v1.json'), 'utf8'),
) as { events: Array<{ type: string }> };

function reportOf(driver: SqlDriver, window: Parameters<typeof buildMetricsReport>[1] = {}) {
  return buildMetricsReport(driver, window);
}

function stepCount(report: ReturnType<typeof buildMetricsReport>, funnel: string, type: string): number {
  const reading = report.readings.find((entry) => entry.funnel === funnel);
  assert.ok(reading, `reading ${funnel} exists`);
  const step = reading.steps.find((entry) => entry.type === type);
  assert.ok(step, `step ${funnel}.${type} exists`);
  return step.count;
}

test('registry guard: categories partition the canonical event table exactly once, no invented names', () => {
  const tableTypes = TABLE.events.map((event) => event.type).sort();
  const registryTypes = Object.values(CATEGORY_EVENTS).flat();
  for (const [category, types] of Object.entries(CATEGORY_EVENTS)) {
    for (const type of types) {
      assert.equal(
        types.filter((entry) => entry === type).length,
        1,
        `${category} lists ${type} exactly once`,
      );
    }
  }
  assert.deepEqual([...registryTypes].sort(), tableTypes);
  for (const steps of Object.values(LABEL_FUNNELS)) {
    for (const step of steps) {
      assert.ok(registryTypes.includes(step), `reading step ${step} is a table type, not an invention`);
    }
  }
  for (const label of FAILURE_LABELS) {
    assert.ok(registryTypes.includes(label), `failure label ${label} is a table type`);
  }
});

test('criterion 1: categoryOf distinguishes the walk chain from purchase/download, unknown stays null', () => {
  assert.equal(categoryOf('route_preview'), 'walk');
  assert.equal(categoryOf('session_started'), 'walk');
  assert.equal(categoryOf('story_audio_completed'), 'walk');
  assert.equal(categoryOf('session_ended'), 'walk');
  assert.equal(categoryOf('purchase_started'), 'commerce');
  assert.equal(categoryOf('download_completed'), 'commerce');
  assert.equal(categoryOf('extension_offer_shown'), 'commerce');
  assert.equal(categoryOf('discovery_offer_opened'), 'discovery');
  assert.equal(categoryOf('guide_nearby_dismissed'), 'hints');
  assert.equal(categoryOf('app_open'), 'app');
  assert.equal(categoryOf('no_such_event'), null);
});

test('criterion 1: the mix guard refuses labels of two categories without a reading chain (map/revert guard)', () => {
  assertNoCategoryMix(['route_preview', 'session_started']);
  assertNoCategoryMix(['purchase_started', 'download_completed']);
  assertNoCategoryMix(['route_preview', 'download_started', 'download_completed', 'session_started']);
  assertNoCategoryMix(['guide_nearby_shown', 'route_preview', 'session_started']);
  assertNoCategoryMix(['purchase_failed', 'autotriggers_unavailable']);
  assertNoCategoryMix(['app_open']);
  assertNoCategoryMix([]);

  const mixed = (labels: string[]) => () => assertNoCategoryMix(labels);
  assert.throws(mixed(['route_preview', 'purchase_started']), (error: unknown) => {
    assert.ok(error instanceof MetricsError);
    assert.equal(error.rule, 'label_mix');
    return true;
  });
  assert.throws(mixed(['story_play_started', 'purchase_succeeded']), MetricsError);
  assert.throws(mixed(['discovery_offer_opened', 'purchase_succeeded']), MetricsError);
  assert.throws(mixed(['made_up_label']), (error: unknown) => {
    assert.ok(error instanceof MetricsError);
    assert.equal(error.rule, 'unknown_label');
    return true;
  });
});

test('criterion 2: a partial walk is not a failure — missed step stays a zero, dismissal is not an error', () => {
  const driver = openFreshEventStore();
  const event = eventFactory('33333333-3333-4333-8333-');
  emitEvent(driver, event({ type: 'route_preview' }));
  emitEvent(driver, event({ type: 'download_started', payload: JSON.stringify({ download_id: 'dl-1', bytes: 0 }) }));
  emitEvent(driver, event({ type: 'download_completed', payload: JSON.stringify({ download_id: 'dl-1', bytes: 10 }) }));
  emitEvent(driver, event({ type: 'session_started' }));
  emitEvent(driver, event({ type: 'story_play_started', payload: JSON.stringify({ stop_id: 's1', story_id: 'st1', play_id: 1, trigger: 'gps' }) }));
  emitEvent(driver, event({ type: 'session_ended', payload: JSON.stringify({ reason: 'user_stop', heard_stories_count: 1 }) }));
  emitEvent(driver, event({ type: 'guide_nearby_dismissed', payload: JSON.stringify({ suggestion_id: 'g1', shown_guide_ids: ['guide-1'], context: 'idle' }) }));

  const report = reportOf(driver);
  assert.deepEqual(report.failures, []);
  assert.equal(stepCount(report, 'listening', 'story_audio_completed'), 0);
  assert.equal(stepCount(report, 'listening', 'story_play_started'), 1);
  assert.equal(stepCount(report, 'walk_preparation', 'session_started'), 1);
  assert.equal(report.unknown_types.length, 0);
  const dismissal = report.labels.find((label) => label.type === 'guide_nearby_dismissed');
  assert.equal(dismissal?.category, 'hints');
});

test('criterion 3: consent states and the pending tail are reported as data boundaries', () => {
  const driver = openFreshEventStore();
  const event = eventFactory('44444444-4444-4444-8444-');
  const first = event({ at: 1_700_000_000_001 });
  emitEvent(driver, first);
  emitEvent(driver, event({ at: 1_700_000_000_002 }));
  emitEvent(driver, event({ at: 1_700_000_000_003 }));
  markEventsSent(driver, [first.eventId]);

  assert.equal(reportOf(driver).boundaries.analytics_consent, 'never_asked');
  assert.equal(reportOf(driver).boundaries.future_sends_blocked, true);

  setAnalyticsConsent(driver, 'granted');
  assert.equal(reportOf(driver).boundaries.analytics_consent, 'granted');
  assert.equal(reportOf(driver).boundaries.future_sends_blocked, false);

  setAnalyticsConsent(driver, 'revoked');
  const report = reportOf(driver);
  assert.equal(report.boundaries.analytics_consent, 'revoked');
  assert.equal(report.boundaries.future_sends_blocked, true);
  assert.equal(report.boundaries.pending_events, 2);
  assert.equal(report.boundaries.server_visibility_ends_at, 1_700_000_000_001);
});

test('criterion 4: a rating-like type is unknown and never joins the discovery counts', () => {
  const driver = openFreshEventStore();
  const event = eventFactory('55555555-5555-4555-8555-');
  emitEvent(driver, event({ type: 'discovery_offer_shown', payload: JSON.stringify({ discovery_revision: 'r1', offer_id: 'o1', kind: 'guide', content_locale: 'be', surface: 'discovery' }) }));
  emitEvent(driver, event({ type: 'discovery_offer_opened', payload: JSON.stringify({ discovery_revision: 'r1', offer_id: 'o1', kind: 'guide', content_locale: 'be', surface: 'discovery' }) }));
  emitEvent(driver, event({ type: 'rating', payload: JSON.stringify({ score: 5 }) }));

  const report = reportOf(driver);
  assert.deepEqual(report.unknown_types, ['rating']);
  assert.equal(stepCount(report, 'discovery', 'discovery_offer_shown'), 1);
  assert.equal(stepCount(report, 'discovery', 'discovery_offer_opened'), 1);
  assert.equal(report.readings.find((entry) => entry.funnel === 'discovery')?.observations, 2);
  const rating = report.labels.find((label) => label.type === 'rating');
  assert.equal(rating?.category, null);
  assert.equal(rating?.count, 1);
  assert.throws(() => assertNoCategoryMix(['discovery_offer_opened', 'rating']), MetricsError);
});

test('criterion 5: the weakened-source share is explicit, an empty sample is fully weakened', () => {
  const driver = openFreshEventStore();
  const event = eventFactory('66666666-6666-4666-8666-');
  const sentIds: string[] = [];
  for (let seq = 1; seq <= 7; seq += 1) {
    const row = event();
    emitEvent(driver, row);
    if (seq % 2 === 1) sentIds.push(row.eventId);
  }
  assert.equal(sentIds.length, 4);
  markEventsSent(driver, sentIds);

  const report = reportOf(driver);
  assert.equal(report.sample.events_total, 7);
  assert.equal(report.sample.server_visible_events, 4);
  assert.equal(report.sample.weakened_share, 3 / 7);

  const empty = reportOf(openFreshEventStore());
  assert.equal(empty.sample.events_total, 0);
  assert.equal(empty.sample.server_visible_events, 0);
  assert.equal(empty.sample.weakened_share, 1);
  assert.equal(empty.boundaries.server_visibility_ends_at, null);
  assert.equal(empty.labels.length, 0);
  assert.deepEqual(empty.failures, []);
});

test('corrupt input: a non-numeric stored at is a named diagnostic, not a crash', () => {
  const driver = openFreshEventStore();
  driver
    .prepare(`INSERT INTO event_queue (event_id, type, at, schema_version, payload, sent) VALUES (?, ?, ?, ?, ?, 0)`)
    .run('77777777-7777-4777-8777-000000000001', 'app_open', 'not-a-number', 1, '{}');
  assert.throws(() => reportOf(driver), (error: unknown) => {
    assert.ok(error instanceof MetricsError);
    assert.equal(error.rule, 'invalid_event_row');
    assert.match(error.message, /77777777-7777-4777-8777-000000000001/);
    return true;
  });
});

test('window bounds are validated and filter the report inclusively', () => {
  const driver = openFreshEventStore();
  const event = eventFactory('88888888-8888-4888-8888-');
  emitEvent(driver, event({ type: 'app_open', at: 100 }));
  emitEvent(driver, event({ type: 'app_open', at: 200 }));
  emitEvent(driver, event({ type: 'explore_option_tap', at: 300 }));

  const report = reportOf(driver, { from: 150, to: 250 });
  assert.equal(report.window.from, 150);
  assert.equal(report.window.to, 250);
  assert.equal(report.sample.events_total, 1);
  assert.equal(report.labels[0]?.type, 'app_open');

  assert.equal(reportOf(driver, {}).window.from, null);
  assert.equal(reportOf(driver, {}).sample.events_total, 3);

  for (const window of [{ from: Number.NaN }, { to: Infinity }, { from: 300, to: 100 }]) {
    assert.throws(() => reportOf(driver, window), (error: unknown) => {
      assert.ok(error instanceof MetricsError);
      assert.equal(error.rule, 'invalid_window');
      return true;
    });
  }
});

test('labels and readings are stable across runs: sorted labels, all declared readings present', () => {
  const driver = openFreshEventStore();
  const event = eventFactory('99999999-9999-4999-8999-');
  emitEvent(driver, event({ type: 'purchase_started', payload: JSON.stringify({ attempt_id: 'a1' }) }));
  emitEvent(driver, event({ type: 'app_open' }));
  emitEvent(driver, event({ type: 'session_paused' }));

  const first = reportOf(driver);
  const second = reportOf(driver);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.labels.map((label) => label.type),
    ['app_open', 'purchase_started', 'session_paused'],
  );
  const label = first.labels.find((entry) => entry.type === 'purchase_started');
  assert.equal(label?.category, 'commerce');
  assert.deepEqual(
    first.readings.map((entry) => entry.funnel),
    Object.keys(LABEL_FUNNELS),
  );
});

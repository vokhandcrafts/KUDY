// G05.02.c — the app-config extraction: the happy path reads the real
// app.json (so the config shape and this reader cannot drift apart), the
// negative tests isolate every missing/malformed entry as a named error,
// never a default string (implementation-rules 14).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { locationExtrasFromConfig } from './location-config.ts';

const appConfig: unknown = JSON.parse(readFileSync(new URL('../../../app.json', import.meta.url), 'utf8'));
// The reader takes the expo config slice (Constants.expoConfig ≡ app.json's
// `expo` object), not the whole file.
const expoConfig: unknown = (appConfig as { expo: unknown }).expo;

test('config: the real app.json carries the extras shape the adapter reads', () => {
  const extras = locationExtrasFromConfig(expoConfig);
  assert.equal(typeof extras.locationExplanations.foreground, 'string');
  assert.equal(typeof extras.locationExplanations.background, 'string');
  assert.equal(typeof extras.locationForegroundService.notificationTitle, 'string');
  assert.equal(typeof extras.locationForegroundService.notificationBody, 'string');
});

const minimalExtras = {
  extra: {
    locationExplanations: { foreground: 'fg', background: 'bg' },
    locationForegroundService: { notificationTitle: 'title', notificationBody: 'body' },
  },
};

test('config: a config without extras fails fast with a named error', () => {
  assert.throws(() => locationExtrasFromConfig({}), /locationExplanations\.foreground/);
  assert.throws(() => locationExtrasFromConfig(undefined), /locationExplanations\.foreground/);
});

const without = (key: string): unknown =>
  JSON.parse(
    JSON.stringify(minimalExtras, (k, v) => (k === key ? undefined : v)),
  );

test('config: every missing extras entry is its own named error, isolated one per test', () => {
  assert.throws(() => locationExtrasFromConfig(without('foreground')), /foreground is missing/);
  assert.throws(() => locationExtrasFromConfig(without('background')), /background is missing/);
  assert.throws(() => locationExtrasFromConfig(without('notificationTitle')), /notificationTitle is missing/);
  assert.throws(() => locationExtrasFromConfig(without('notificationBody')), /notificationBody is missing/);
});

test('config: an empty string is as missing — no silent defaults', () => {
  const empty = JSON.parse(JSON.stringify(minimalExtras));
  (empty.extra.locationExplanations as Record<string, unknown>).foreground = '';
  assert.throws(() => locationExtrasFromConfig(empty), /foreground is missing or empty/);
});

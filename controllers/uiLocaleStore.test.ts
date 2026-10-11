// G14.04.d (issue #305) — the UI-locale switch store: the closed be/en/uk
// vocabulary (an unknown value is a named error, the state never moves),
// the listener notification the useSyncExternalStore hook rides, and the
// optional durable write-through (the consent idiom's seam). The store
// holds no session/run reference — switching the UI locale cannot reach the
// walk's pinned locale or its audio by construction (uk-release-scope §4).
import test from 'node:test';
import assert from 'node:assert/strict';

import { createUiLocaleStore, UiLocaleError } from './uiLocaleStore.ts';
import { OPEN_UI_LOCALES } from '../contracts/ui-locales.ts';

test('G14.04.d #305: the store starts on be, the first preference', () => {
  const store = createUiLocaleStore();
  assert.equal(store.current(), 'be');
});

test('G14.04.d #305: the store starts on the persisted choice when the port carries one', () => {
  const store = createUiLocaleStore({ read: () => 'uk', write: () => {} });
  assert.equal(store.current(), 'uk');
});

test('G14.04.d #305: set switches the value, notifies and writes through', () => {
  const written: string[] = [];
  const store = createUiLocaleStore({ read: () => null, write: (locale) => written.push(locale) });
  const events: string[] = [];
  const unsubscribe = store.subscribe(() => events.push(store.current()));
  store.set('uk');
  assert.equal(store.current(), 'uk');
  assert.deepEqual(written, ['uk']);
  assert.deepEqual(events, ['uk']);
  unsubscribe();
});

test('G14.04.d #305: an unknown value is a named error and moves nothing', () => {
  const written: string[] = [];
  const store = createUiLocaleStore({ read: () => null, write: (locale) => written.push(locale) });
  const events: string[] = [];
  store.subscribe(() => events.push(store.current()));
  assert.throws(() => store.set('ru'), (error: unknown) => error instanceof UiLocaleError);
  assert.equal(store.current(), 'be');
  assert.deepEqual(written, []);
  assert.deepEqual(events, []);
});

test('G14.04.d #305: setting the current value is a no-op — no event, no write', () => {
  const written: string[] = [];
  const store = createUiLocaleStore({ read: () => null, write: (locale) => written.push(locale) });
  const events: string[] = [];
  store.subscribe(() => events.push(store.current()));
  store.set('be');
  assert.deepEqual(written, []);
  assert.deepEqual(events, []);
});

test('G14.04.d #305: the listener sees the new value inside the notification', () => {
  const store = createUiLocaleStore();
  let seen: string | null = null;
  store.subscribe(() => {
    seen = store.current();
  });
  store.set('en');
  assert.equal(seen, 'en');
});

// G21.15 (issue #549): the durable write is best-effort — a failed write
// (a closed db, a full disk) must not undo the session choice, strand the
// listeners or escape the set() call into the press handler. Symmetric with
// the seam's read: a corrupt row reads as no choice, never a throw.
test('G21.15 #549: a failed durable write leaves the switch standing and the listeners firing', () => {
  let writes = 0;
  const store = createUiLocaleStore({
    read: () => null,
    write: () => {
      writes += 1;
      throw new Error('db#closed');
    },
  });
  const events: string[] = [];
  const unsubscribe = store.subscribe(() => events.push(store.current()));
  store.set('uk');
  assert.equal(store.current(), 'uk');
  assert.deepEqual(events, ['uk']);
  assert.equal(writes, 1);
  unsubscribe();
});

test('G21.15 #549: after a failed write the next switch writes through again', () => {
  const written: string[] = [];
  let fail = true;
  const store = createUiLocaleStore({
    read: () => null,
    write: (locale) => {
      if (fail) throw new Error('db#closed');
      written.push(locale);
    },
  });
  store.set('uk');
  assert.equal(store.current(), 'uk');
  fail = false;
  store.set('en');
  assert.deepEqual(written, ['en']);
  assert.equal(store.current(), 'en');
});

// G21.50 (issue #711, criterion 3): the switch vocabulary is the OPEN set,
// not the complete set. The injected open set is the tests' seam — with no
// registered-but-closed code in the real registry yet, a two-code fixture
// plays the gate. Removing the fallback or the open-set check turns these red.
test('G21.50 #711: a stored registered-but-closed code falls back to be without a write or a throw', () => {
  const written: string[] = [];
  const store = createUiLocaleStore({ read: () => 'en', write: (locale) => written.push(locale) }, ['be', 'uk']);
  assert.equal(store.current(), 'be');
  assert.deepEqual(written, [], 'the stored row is not overwritten');
});

test('G21.50 #711: the stored code restores on a later read once the open set includes it', () => {
  const store = createUiLocaleStore({ read: () => 'en', write: () => {} }, ['be', 'en', 'uk']);
  assert.equal(store.current(), 'en');
});

test('G21.50 #711: setting a registered-but-closed code is ui-locale-closed and moves nothing', () => {
  const written: string[] = [];
  const events: string[] = [];
  const store = createUiLocaleStore({ read: () => null, write: (locale) => written.push(locale) }, ['be']);
  store.subscribe(() => events.push(store.current()));
  assert.throws(
    () => store.set('en'),
    (error: unknown) => error instanceof UiLocaleError && error.rule === 'ui-locale-closed',
  );
  assert.equal(store.current(), 'be');
  assert.deepEqual(written, []);
  assert.deepEqual(events, []);
});

test('G21.50 #711: an unregistered code keeps ui-locale-unknown under the open set', () => {
  const store = createUiLocaleStore(undefined, ['be']);
  assert.throws(
    () => store.set('ru'),
    (error: unknown) => error instanceof UiLocaleError && error.rule === 'ui-locale-unknown',
  );
});

test('G21.50 #711: without an injection the open set is the registry fact', () => {
  const store = createUiLocaleStore();
  for (const code of OPEN_UI_LOCALES) {
    store.set(code);
    assert.equal(store.current(), code);
  }
});

// G07.02 (issue #282) — the place detail controller suite: the facts from
// the already-validated catalog projection, the teasers filtered by
// place_id, and the honest states when the catalog or the reader fails
// (rule 14 — diagnostics, never throws).
import test from 'node:test';
import assert from 'node:assert/strict';

import { createPlaceDetailController } from './placeDetailController.ts';
import type { CatalogService, NearbyLoadState, NearbyOfferFacts } from '../../services/catalog/types.ts';
import type { MomentFacts } from '../../services/contentRepo/momentFacts.ts';

const PLACE_OFFER: NearbyOfferFacts = {
  offer_id: 'offer-a1-place',
  kind: 'place',
  route_id: null,
  place_id: 'place-a1',
  editorial_order: 1,
  title: 'Двор сукнараў',
  summary: 'Ціхі дворык',
  distance_m: null,
  text_locales: ['be'],
  audio_locales: [],
  access: 'free',
  estimated_duration: null,
};

const TEASER: MomentFacts = {
  ok: true,
  moments: [
    {
      momentId: 'm-a1',
      placeId: 'place-a1',
      storyId: 's-a1',
      kind: 'teaser',
      cooldownMin: 60,
      routeId: 'route-a1',
      version: '1',
      audioPath: 'bundles/route-a1/1/be/base/audio/s-a1.m4a',
      teaserText: 'Тэйзер-тэкст',
    },
    {
      momentId: 'm-other',
      placeId: 'place-other',
      storyId: 's-other',
      kind: 'teaser',
      cooldownMin: 60,
      routeId: 'route-other',
      version: '1',
      audioPath: null,
      teaserText: null,
    },
  ],
  diagnostics: [],
};

function serviceWith(outcome: Promise<NearbyLoadState> | (() => Promise<NearbyLoadState>)) {
  return {
    loadNearby: (typeof outcome === 'function' ? outcome : () => outcome) as CatalogService['loadNearby'],
  };
}

// The loaded binding of one scenario: create + two microtask ticks (the
// boot load's settle), the state read back — the shared arrange of every
// test here (a sibling copy is a jscpd clone).
async function loaded(deps: Parameters<typeof createPlaceDetailController>[0]) {
  const store = createPlaceDetailController(deps);
  await Promise.resolve();
  await Promise.resolve();
  return store.store.getState();
}

test('the detail resolves the place offer facts and only this place’s teasers', async () => {
  const state = await loaded({
    service: serviceWith(Promise.resolve({ kind: 'ready', offers: [PLACE_OFFER], degraded: null })),
    moments: () => Promise.resolve(TEASER),
    placeId: 'place-a1',
  });
  assert.ok(state.kind === 'ready');
  if (state.kind !== 'ready') return;
  assert.equal(state.facts?.title, 'Двор сукнараў');
  assert.deepEqual(state.moments.map((moment) => moment.momentId), ['m-a1']);
  assert.equal(state.degraded, null);
});

test('a place the index does not offer renders its teasers with the honest no-facts state', async () => {
  const state = await loaded({
    service: serviceWith(Promise.resolve({ kind: 'ready', offers: [PLACE_OFFER], degraded: 'index-unavailable' })),
    moments: () => Promise.resolve(TEASER),
    placeId: 'place-z9',
  });
  assert.ok(state.kind === 'ready');
  if (state.kind !== 'ready') return;
  assert.equal(state.facts, null);
  assert.deepEqual(state.moments, []);
  assert.equal(state.degraded, 'index-unavailable');
});

test('a failed catalog leaves the teasers rendering (library truth), facts null', async () => {
  const state = await loaded({
    service: serviceWith(Promise.resolve({ kind: 'error', reason: 'catalog#fetch-failed' })),
    moments: () => Promise.resolve(TEASER),
    placeId: 'place-a1',
  });
  assert.ok(state.kind === 'ready');
  if (state.kind !== 'ready') return;
  assert.equal(state.facts, null);
  assert.deepEqual(state.moments.map((moment) => moment.momentId), ['m-a1']);
});

test('a failed moments reader is the honest empty — never a throw', async () => {
  const state = await loaded({
    service: serviceWith(Promise.resolve({ kind: 'ready', offers: [PLACE_OFFER], degraded: null })),
    moments: () => Promise.resolve({ ok: false, diagnostic: 'moment-facts#list-failed' }),
    placeId: 'place-a1',
  });
  assert.ok(state.kind === 'ready');
  if (state.kind !== 'ready') return;
  assert.deepEqual(state.moments, []);
});

test('a thrown load is the named error state', async () => {
  const state = await loaded({
    service: serviceWith(async () => {
      throw new Error('gone');
    }),
    placeId: 'place-a1',
  });
  assert.deepEqual(state, { kind: 'error', reason: 'place#load-failed' });
});

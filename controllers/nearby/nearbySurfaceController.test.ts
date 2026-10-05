// G07.01 (issue #281) — the Nearby surface's node suite: the pure decisions
// behind the render tests — the arming guard per mode (criterion 4), the two
// view orders (criteria 1–2) and the BE/EN word sets (criterion 5). The
// render suite (app/map.test.tsx) runs the same decisions through the real
// composition root.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NearbyOfferFacts } from '../../services/catalog/types.ts';
import {
  nearbyArmingDecision,
  nearbyOrder,
  nearbyStrings,
} from './nearbySurfaceController.ts';

function offer(
  offer_id: string,
  kind: 'guide' | 'place',
  editorial_order: number,
  distance_m: number | null,
): NearbyOfferFacts {
  return {
    offer_id,
    kind,
    route_id: kind === 'guide' ? `route-${offer_id}` : null,
    place_id: kind === 'place' ? `place-${offer_id}` : null,
    editorial_order,
    title: null,
    summary: null,
    distance_m,
    text_locales: ['be'],
    audio_locales: [],
    access: 'free',
    estimated_duration: null,
    content_version: null,
    content_locale: null,
  };
}

describe('nearbyArmingDecision (criterion 4)', () => {
  it('arms the city subscription only when no walk holds the mode', () => {
    assert.equal(nearbyArmingDecision('idle'), 'arm');
    assert.equal(nearbyArmingDecision('city-surface'), 'arm');
  });

  it('holds when a live or paused walk owns the subscription (the G07.03 context)', () => {
    assert.equal(nearbyArmingDecision('active-guide'), 'hold');
    assert.equal(nearbyArmingDecision('paused'), 'hold');
  });
});

describe('nearbyOrder (criteria 1–2)', () => {
  const offers = [
    offer('offer-c1-place', 'place', 3, null),
    offer('offer-b1-guide', 'guide', 1, 3200),
    offer('offer-e1-place', 'place', 5, 400),
    offer('offer-a1-place', 'place', 2, 800),
  ];

  it('the review view keeps the canon order: editorial_order, then offer_id', () => {
    assert.deepEqual(
      nearbyOrder(offers, { state: 'absent' }).map((entry) => entry.offer_id),
      ['offer-b1-guide', 'offer-a1-place', 'offer-c1-place', 'offer-e1-place'],
    );
    assert.deepEqual(
      nearbyOrder(offers, { state: 'denied' }).map((entry) => entry.offer_id),
      ['offer-b1-guide', 'offer-a1-place', 'offer-c1-place', 'offer-e1-place'],
    );
  });

  it('the proximity view orders nearest-first, unknown figures last, ties by the canon order', () => {
    const view: Parameters<typeof nearbyOrder>[1] = { state: 'proximity', note: null };
    assert.deepEqual(
      nearbyOrder(offers, view).map((entry) => entry.offer_id),
      ['offer-e1-place', 'offer-a1-place', 'offer-b1-guide', 'offer-c1-place'],
    );
  });

  it('never mutates the input list', () => {
    const input = [offer('offer-b', 'guide', 2, 400), offer('offer-a', 'place', 1, 800)];
    nearbyOrder(input, { state: 'proximity', note: null });
    assert.deepEqual(
      input.map((entry) => entry.offer_id),
      ['offer-b', 'offer-a'],
    );
  });
});

describe('nearbyStrings (criterion 5)', () => {
  it('carries the same word set in BE and EN', () => {
    const be = nearbyStrings('be');
    const en = nearbyStrings('en');
    assert.deepEqual(Object.keys(be).sort(), Object.keys(en).sort());
    assert.equal(be.title, 'Побач');
    assert.equal(en.title, 'Nearby');
    // The honest no-audio guarantee reads in both languages (R04).
    assert.match(be.cardHint, /Аўдыё не запускаецца/);
    assert.match(en.cardHint, /Audio does not start/);
  });

  it('carries the uk words and falls back to Belarusian for an unknown locale (G14.04.d; 09 §0)', () => {
    // G14.04.d (issue #305): uk answers from its own catalog now — the
    // unknown-locale fallback is probed on a locale no catalog answers.
    // G21.10 (issue #544): de answers from its own catalogue, so the probe
    // moved to the still-planned es.
    assert.equal(nearbyStrings('uk').title, 'Поруч');
    assert.equal(nearbyStrings('es').title, 'Побач');
  });
});

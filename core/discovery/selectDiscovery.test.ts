// G15.01 — acceptance suite for the pure discovery selector (issue #68).
// Criteria (docs/agent-tasks/discovery/G15.01.md):
// 1. 60 minutes rejects [45,75] from exact; 120 accepts it (cases B-over-time/B-exact).
// 2. Unknown time becomes an explicitly labeled alternative only (case C).
// 3. Wrong city or explicit content locale is excluded even from alternatives (case E + D guard).
// 4. One exact result stays alone; zero exact does not silently widen conditions (cases H/C).
// 5. Same input and ordering ties always produce the same offer IDs; duplicate refs
//    are not displayed twice.
// Fixture source: fixtures/discovery-contract/index-valid.json with the accepted
// selector cases from fixtures/discovery-contract/criteria-cases.json (G01.06).
// Immutability proofs (task step 4): paid flags and hypothetical score fields do
// not change the output; the criteria type accepts no ratings input.
// Wiring guards (implementation-rules 1 and 7) pin the core suite into the default
// npm test command and its own typecheck pass — each fails when the wiring reverts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  selectDiscovery,
  type DiscoveryCriteria,
  type DiscoveryIndexV1,
  type DiscoveryOffer,
} from './selectDiscovery.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');

const indexValid = JSON.parse(read('fixtures/discovery-contract/index-valid.json')) as DiscoveryIndexV1;
const cases = JSON.parse(read('fixtures/discovery-contract/criteria-cases.json')) as {
  cases: Array<{ id: string; criteria: DiscoveryCriteria; expected: Record<string, unknown> }>;
};
const caseById = new Map(cases.cases.map((c) => [c.id, c]));

const criteriaOf = (id: string): DiscoveryCriteria => {
  const c = caseById.get(id);
  assert.ok(c, `criteria case ${id} must exist in criteria-cases.json`);
  return c.criteria;
};

const ids = (matches: ReadonlyArray<{ offer_id: string }>) => matches.map((m) => m.offer_id);

const assertAlternative = (
  result: ReturnType<typeof selectDiscovery>,
  offerId: string,
  differences: readonly string[],
) => {
  const match = result.alternatives.find((m) => m.offer_id === offerId);
  assert.ok(match, `${offerId} must be an alternative`);
  assert.deepEqual(match.differences, differences, `${offerId} differences`);
};

test('criterion 1: 60 minutes rejects [45,75] from exact (case B-over-time)', () => {
  const result = selectDiscovery(indexValid, criteriaOf('B-over-time'));
  assert.ok(!ids(result.exact).includes('offer-b1-guide'), 'the [45,75] guide is not exact at 60');
  assertAlternative(result, 'offer-b1-guide', ['over_time']);
});

test('criterion 1: 120 minutes accepts [45,75] into exact, editorial order (case B-exact)', () => {
  const result = selectDiscovery(indexValid, criteriaOf('B-exact'));
  assert.deepEqual(ids(result.exact), [
    'offer-b1-guide',
    'offer-a1-place',
    'offer-f1-collection',
    'offer-g1-place',
    'offer-h1-place',
  ]);
});

test('criterion 2: unknown time is an explicitly labeled alternative only (case C)', () => {
  const result = selectDiscovery(indexValid, criteriaOf('C'));
  assert.deepEqual(ids(result.exact), [], 'no silent widening: zero exact stays zero');
  assertAlternative(result, 'offer-c1-place', ['duration_unknown']);
});

test('criterion 3: an en-only offer is never substituted for explicit be (case E)', () => {
  const result = selectDiscovery(indexValid, criteriaOf('E'));
  assert.ok(!ids(result.exact).includes('offer-e1-place'));
  assert.ok(!ids(result.alternatives).includes('offer-e1-place'));
});

test('criterion 3: a foreign-city offer is excluded even from alternatives (case D guard)', () => {
  // Case D proves the file-level rejection in the contracts suite; here the
  // selector itself must not surface a wrong-city offer it may defensively see.
  const foreign: DiscoveryOffer = {
    offer_id: 'offer-d1-guide',
    ref: { kind: 'guide', route_id: 'guide-route-d1', version: '1' },
    city_id: 'city-b',
    editorial_order: 0,
    themes: ['theme-history'],
    localized: { title: { be: 'Чужы гід' }, why_recommended: { be: 'р' }, conditions: { be: 'у' } },
    estimated_duration: { min_minutes: 10, max_minutes: 20, basis: 'author_estimate' },
    season_recommendations: [],
    availability: { text_locales: ['be'], audio_locales: [] },
    access: 'free',
    detail_ref: { kind: 'guide_preview' },
  };
  const mixed: DiscoveryIndexV1 = { ...indexValid, offers: [foreign, ...indexValid.offers] };
  const result = selectDiscovery(mixed, criteriaOf('B-exact'));
  assert.ok(!ids(result.exact).includes('offer-d1-guide'));
  assert.ok(!ids(result.alternatives).includes('offer-d1-guide'));
});

test('criterion 4: one exact result stays alone (case H)', () => {
  const result = selectDiscovery(indexValid, criteriaOf('H'));
  assert.deepEqual(ids(result.exact), ['offer-h1-place']);
  assert.ok(result.alternatives.length > 0, 'the rest stays labeled as alternatives, nothing is promoted');
});

test('criterion 4: explicit autumn separates unassessed from not-recommended (case G)', () => {
  const result = selectDiscovery(indexValid, criteriaOf('G'));
  assertAlternative(result, 'offer-g1-place', ['season_unassessed']);
  assertAlternative(result, 'offer-a1-place', ['season_not_recommended']);
  assertAlternative(result, 'offer-f1-collection', ['over_time']);
});

test('criterion 5: the accepted case set A reproduces exact order and labeled alternatives', () => {
  const result = selectDiscovery(indexValid, criteriaOf('A'));
  assert.deepEqual(ids(result.exact), ['offer-a1-place', 'offer-g1-place', 'offer-h1-place']);
  assertAlternative(result, 'offer-b1-guide', ['over_time']);
  assertAlternative(result, 'offer-f1-collection', ['over_time']);
});

test('criterion 5: same input, same output (determinism)', () => {
  const criteria = criteriaOf('B-exact');
  assert.deepEqual(selectDiscovery(indexValid, criteria), selectDiscovery(indexValid, criteria));
});

test('criterion 5: ordering ties break by offer_id, duplicate refs are shown once', () => {
  const twinA: DiscoveryOffer = {
    offer_id: 'offer-x1-place',
    ref: { kind: 'place', place_id: 'place-x', content_version: '1' },
    city_id: 'city-a',
    editorial_order: 3,
    themes: ['theme-history'],
    localized: { title: { be: 'Блізняк A' }, why_recommended: { be: 'р' }, conditions: { be: 'у' } },
    estimated_duration: { min_minutes: 10, max_minutes: 20, basis: 'author_walk' },
    season_recommendations: [],
    availability: { text_locales: ['be'], audio_locales: [] },
    access: 'free',
    detail_ref: { kind: 'place_public', path: 'places/place-x/public.json' },
  };
  const twinB: DiscoveryOffer = { ...twinA, offer_id: 'offer-x2-place', localized: { title: { be: 'Блізняк B' }, why_recommended: { be: 'р' }, conditions: { be: 'у' } } };
  const withTwins: DiscoveryIndexV1 = { ...indexValid, offers: [twinB, twinA, ...indexValid.offers] };
  const result = selectDiscovery(withTwins, criteriaOf('B-exact'));
  const shown = [...ids(result.exact), ...ids(result.alternatives)].filter((id) => id.startsWith('offer-x'));
  assert.deepEqual(shown, ['offer-x1-place'], 'one ref, the deterministic twin');
});

test('step 4 proof: paid flags do not change order — every offer set to free', () => {
  const allFree: DiscoveryIndexV1 = {
    ...indexValid,
    offers: indexValid.offers.map((o) => ({ ...o, access: 'free' as const })),
  };
  for (const id of ['A', 'B-over-time', 'B-exact', 'C', 'G', 'H']) {
    const criteria = criteriaOf(id);
    assert.deepEqual(
      selectDiscovery(allFree, criteria),
      selectDiscovery(indexValid, criteria),
      `case ${id} must be access-blind`,
    );
  }
});

test('step 4 proof: a hypothetical score field on offers changes nothing', () => {
  const scored: DiscoveryIndexV1 = {
    ...indexValid,
    offers: indexValid.offers.map((o) => ({ ...o, hypothetical_score: 5, rating: 4.9 }) as DiscoveryOffer),
  };
  for (const id of ['A', 'B-exact', 'C', 'G', 'H']) {
    const criteria = criteriaOf(id);
    assert.deepEqual(
      selectDiscovery(scored, criteria),
      selectDiscovery(indexValid, criteria),
      `case ${id} must not read scores`,
    );
  }
});

test('step 4 proof: no ratings input is accepted — extra criteria fields change nothing', () => {
  const withRating = { ...criteriaOf('B-exact'), rating: 5 } as unknown as DiscoveryCriteria;
  assert.deepEqual(selectDiscovery(indexValid, withRating), selectDiscovery(indexValid, criteriaOf('B-exact')));
});

test('criterion 3 guard: corrupt offer input degrades fail-closed, never throws', () => {
  const corrupt = {
    offer_id: 'offer-z1-place',
    ref: { kind: 'place' },
    city_id: 'city-a',
    editorial_order: 0,
    season_recommendations: [],
  } as unknown as DiscoveryOffer;
  const mixed: DiscoveryIndexV1 = { ...indexValid, offers: [corrupt, ...indexValid.offers] };
  const result = selectDiscovery(mixed, criteriaOf('B-exact'));
  assert.ok(!ids(result.exact).includes('offer-z1-place'));
  assert.ok(!ids(result.alternatives).includes('offer-z1-place'));
});

test('wiring: the discovery core suite runs in the default npm test command', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.test, /"core\/\*\*\/\*\.test\.ts"/);
});

test('wiring: core is typechecked by its own pass, excluded from the Expo root config', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.typecheck, /tsc --noEmit -p core/, 'the core typecheck pass vanished from npm run typecheck');
  const cfg = JSON.parse(read('tsconfig.json'));
  assert.equal((cfg.exclude ?? []).includes('core'), true, 'root tsc must keep excluding core (TS5097 on .ts specifiers)');
});

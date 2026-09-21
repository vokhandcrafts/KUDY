// G15.02 — acceptance suite for the authored discovery content (issue #69).
// Pins the real-content decisions of content/discovery/ against the contracts
// and the authoring workspace: standalone places, the collection's own
// duration, the autumn recommendation on unchanged points, the no-claims
// discipline for opening hours/access, and the editorial-log claim anchors.
// Every test fails when the pinned content decision is reverted.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePackage } from './validate-package.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const PKG = path.join(REPO, 'content', 'discovery');
const LOG = path.join(REPO, 'docs', 'content', 'discovery-editorial-log.md');
const SCENARIO = path.join(REPO, 'authoring', 'gdansk', 'scenarios', 'gdansk-first-walk.json');
const CLAIMS = path.join(REPO, 'authoring', 'gdansk', 'claims.json');
const FRAGMENTS = path.join(REPO, 'authoring', 'gdansk', 'fragments.json');

const readJson = (dir, rel) => JSON.parse(fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8'));

const route = readJson(PKG, 'route.json');
const places = readJson(PKG, 'places.json');
const discovery = readJson(PKG, 'discovery.json');
const placeById = new Map(places.map((p) => [p.id, p]));
const offerById = new Map(discovery.offers.map((o) => [o.offer_id, o]));

// Collects every localized string in the package's card texts for the
// no-claims scan (discovery.json offers + public projections).
function* localizedStrings(node) {
  if (Array.isArray(node)) {
    for (const item of node) yield* localizedStrings(item);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string' && ['be', 'en', 'uk'].includes(key)) yield value;
      else if (key !== 'ref' && key !== 'detail_ref') yield* localizedStrings(value);
    }
  }
}

test('criterion 1: the authored package validates clean; warnings are only radius-overlap field-check hints', () => {
  const result = validatePackage(PKG);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  for (const warning of result.warnings) {
    assert.equal(warning.rule, 'radius-overlap', JSON.stringify(warning));
  }
});

test('criterion 1: standalone places are offered without belonging to the runnable guide', () => {
  const stopPlaceIds = new Set(route.stops.map((s) => s.place_id));
  const standalone = discovery.offers.filter(
    (o) => o.ref.kind === 'place' && !stopPlaceIds.has(o.ref.place_id),
  );
  assert.ok(standalone.length >= 2, 'at least two standalone place offers expected');
  for (const offer of standalone) {
    const place = placeById.get(offer.ref.place_id);
    assert.ok(place, `unknown place ${offer.ref.place_id}`);
    assert.equal(
      place.content_version,
      offer.ref.content_version,
      `${offer.ref.place_id} version mismatch`,
    );
    // Every standalone place offer carries its own public projection at detail_ref.
    const projectionRel = offer.detail_ref.path;
    assert.ok(fs.existsSync(path.join(PKG, projectionRel)), `missing projection ${projectionRel}`);
    assert.equal(
      readJson(PKG, projectionRel).place_id,
      offer.ref.place_id,
      'projection owner mismatch',
    );
  }
  // At least one standalone place is fully independent — neither a guide stop
  // nor a collection member — so selection never requires the guide.
  const memberPlaceIds = new Set(
    discovery.collections.flatMap((c) => c.members.filter((m) => m.kind === 'place').map((m) => m.place_id)),
  );
  const independent = standalone.filter((offer) => !memberPlaceIds.has(offer.ref.place_id));
  assert.ok(
    independent.length >= 1,
    'at least one standalone place must live outside every collection too',
  );
});

test('criterion 2: the collection carries its own duration assessment, not the sum of card times', () => {
  const collection = discovery.collections[0];
  assert.equal(collection.collection_id, 'collection-gdansk-halfday');
  const collectionOffer = offerById.get('offer-collection-gdansk-halfday');
  const own = collectionOffer.estimated_duration;
  assert.ok(own, 'collection offer must carry estimated_duration');
  assert.equal(own.basis, 'author_estimate');
  // Naive sum of the members' card ranges: guide [45,60] + monastery [15,30]
  // = [60,90]. The collection's own range is that plus the 5–10 min
  // transition between the guide's end and the monastery — longer at both
  // ends, never the card sum (20 §4.3).
  const guideOffer = offerById.get('offer-guide-gdansk-first-walk');
  const monasteryOffer = offerById.get('offer-place-gdansk-franciscan');
  const sumMin = guideOffer.estimated_duration.min_minutes + monasteryOffer.estimated_duration.min_minutes;
  const sumMax = guideOffer.estimated_duration.max_minutes + monasteryOffer.estimated_duration.max_minutes;
  assert.ok(
    own.min_minutes > sumMin && own.max_minutes > sumMax,
    'the collection range must exceed the card sum: transitions take time (20 §4.3)',
  );
  assert.deepEqual(own, { min_minutes: 65, max_minutes: 100, basis: 'author_estimate' });
  // Members resolve against the package; the guide member is the paid pilot route.
  assert.equal(route.access, 'paid');
  const guideMember = collection.members.find((m) => m.kind === 'guide');
  assert.deepEqual(guideMember, { kind: 'guide', route_id: route.route_id, version: route.version });
});

test('criterion 3: the autumn recommendation sits on the monastery offer with unchanged points', () => {
  const monastery = offerById.get('offer-place-gdansk-franciscan');
  assert.equal(monastery.season_recommendations.length, 1);
  const rec = monastery.season_recommendations[0];
  assert.equal(rec.season, 'autumn');
  assert.ok(rec.reason.be.length > 0 && rec.reason.be.length <= 280);
  assert.ok(rec.reason.en.length > 0 && rec.reason.en.length <= 280);
  // Unchanged points: the route's stop order still mirrors the author's
  // scenario (the recommendation added no stops, no reorder, no new route).
  const scenario = readJson(path.dirname(SCENARIO), path.basename(SCENARIO));
  assert.deepEqual(
    route.stops.map((s) => ({ place_id: s.place_id, position: s.position })),
    scenario.stops.map((s, i) => ({ place_id: s.place_id, position: i })),
  );
  // No other offer silently gained a season (empty = not_assessed stays honest).
  for (const offer of discovery.offers) {
    if (offer.offer_id !== monastery.offer_id) {
      assert.deepEqual(offer.season_recommendations, [], `${offer.offer_id} gained a season`);
    }
  }
});

test('criterion 4: no card text claims opening hours, entry prices or free admission', () => {
  const patterns = [
    /\d{1,2}[:.]\d{2}/, // clock times like 10:00
    /opening hours?|open (daily|from)|closed (on|from)/i,
    /(гадзіны працы|час працы)\s*[:\-–—]?\s*\d/,
    /(бясплатны ўваход|уваход бясплатны|free (entry|admission))/i,
    /(цана|цены|кошт)[^.\n]{0,20}\d/, // a price next to a number
  ];
  // Every localized card string in the package: the whole discovery doc
  // (offers + collection + theme labels) and every public projection.
  const texts = [...localizedStrings(discovery)];
  const walkProjections = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkProjections(full);
      else if (entry.isFile() && entry.name === 'public.json') {
        texts.push(...localizedStrings(readJson(path.dirname(full), 'public.json')));
      }
    }
  };
  walkProjections(path.join(PKG, 'places'));
  walkProjections(path.join(PKG, 'collections'));
  assert.ok(texts.length >= 10, 'the scan must actually cover the card texts');
  for (const text of texts) {
    for (const pattern of patterns) {
      assert.doesNotMatch(text, pattern, `claim-like text found: ${JSON.stringify(text)}`);
    }
  }
});

test('criterion 5: the paid-guide collection grants nothing and creates no product', () => {
  const collection = discovery.collections[0];
  // Schema closure, restated as a guard: no product/price/entitlement field
  // may appear on the collection or its offer (21 §3.2, additionalProperties false).
  const forbidden = /product|price|entitlement/i;
  for (const key of Object.keys(collection)) {
    assert.doesNotMatch(key, forbidden, `forbidden key on collection: ${key}`);
  }
  const collectionOffer = offerById.get('offer-collection-gdansk-halfday');
  for (const key of Object.keys(collectionOffer)) {
    assert.doesNotMatch(key, forbidden, `forbidden key on collection offer: ${key}`);
  }
  // No overlap note is required: no member place is any guide offer's start.
  const starts = discovery.offers
    .filter((o) => o.ref.kind === 'guide' && o.suggested_start_place_id)
    .map((o) => o.suggested_start_place_id);
  for (const member of collection.members) {
    if (member.kind === 'place') {
      assert.ok(!starts.includes(member.place_id), 'an overlapping composition would need overlap_note');
    }
  }
  assert.equal(collection.overlap_note, undefined);
  // No nested collections anywhere.
  for (const member of collection.members) {
    assert.notEqual(member.kind, 'collection');
  }
});

test('guard: editorial-log claim and fragment anchors resolve in the authoring workspace', () => {
  const log = fs.readFileSync(LOG, 'utf8');
  const claims = readJson(path.dirname(CLAIMS), path.basename(CLAIMS));
  const fragments = readJson(path.dirname(FRAGMENTS), path.basename(FRAGMENTS));
  const claimList = Array.isArray(claims) ? claims : claims.claims;
  const fragmentList = Array.isArray(fragments) ? fragments : fragments.fragments;
  const claimById = new Map(claimList.map((c) => [c.claim_id, c]));
  const fragmentById = new Map(fragmentList.map((f) => [f.fragment_id, f]));
  const cited = [...log.matchAll(/\b(cl|fr)-\d{3}\b/g)].map((m) => m[0]);
  assert.ok(cited.length >= 5, 'the anchor table must cite the pipeline');
  for (const id of new Set(cited)) {
    if (id.startsWith('cl-')) {
      const claim = claimById.get(id);
      assert.ok(claim, `log cites unknown claim ${id}`);
      assert.notEqual(claim.mark, 'rejected', `log cites rejected claim ${id}`);
    } else {
      assert.ok(fragmentById.has(id), `log cites unknown fragment ${id}`);
    }
  }
});

test('guard: content/discovery ships data only, no executable file', () => {
  const executables = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && fs.statSync(full).mode & 0o111) executables.push(full);
    }
  };
  walk(PKG);
  assert.deepEqual(executables, [], 'content packages are data; import code is G12.01');
});

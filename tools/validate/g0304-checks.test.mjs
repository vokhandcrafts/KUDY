// G03.04 — acceptance suite for the media/moments checks (issue #301).
// Criterion 1: every media file carries a license/credit Media record
// (media.json, media.schema.json), sha256-matched to exactly one file; place
// name_audio_refs and record voices resolve. Criterion 2: the packer rejects
// a story whose tier contradicts its layer and a locked preview containing
// the stop's full story text. Criterion 3: moments.json records are
// manual-only — the moment schema's additionalProperties:false rejects any
// auto-trigger field, and refs resolve. Criterion 4: availability never
// claims audio without text (09 §3 invariant 1), and the built artifacts
// separate text locales from audio locales. Every negative case isolates one
// violation and names its rule (implementation-rules 14).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BuildError, buildBundle } from '../build-bundle/build-bundle.mjs';
import { validateDiscoveryIndex, validatePackage } from './validate-package.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEMO = path.resolve(HERE, '..', '..', 'fixtures/content/demo-route');

const readJson = (dir, rel) => JSON.parse(fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8'));
const writeJson = (dir, rel, doc) => fs.writeFileSync(path.join(dir, ...rel.split('/')), JSON.stringify(doc, null, 2));

function copiedTree(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g0304-'));
  fs.cpSync(DEMO, dir, { recursive: true });
  if (mutate) mutate(dir);
  return dir;
}

const rules = (result, name) => result.errors.filter((e) => e.rule === name);

test('criterion 1: an uncovered media file is unlicensed-media', () => {
  const withoutRecord = validatePackage(copiedTree((d) => {
    const media = readJson(d, 'media.json');
    writeJson(d, 'media.json', media.filter((record) => record.media_id !== 'media-story-1-base-en'));
  }));
  assert.ok(
    rules(withoutRecord, 'unlicensed-media').some((e) => e.path === 'en/base/audio/story-1-base.m4a'),
    JSON.stringify(withoutRecord.errors),
  );
  const withoutManifest = validatePackage(copiedTree((d) => fs.rmSync(path.join(d, 'media.json'))));
  assert.equal(rules(withoutManifest, 'unlicensed-media').length, 4, JSON.stringify(withoutManifest.errors));
});

test('criterion 1: a record whose sha256 matches no file is media-sha-unmatched', () => {
  const result = validatePackage(copiedTree((d) => {
    const media = readJson(d, 'media.json');
    media[0].sha256 = media[0].sha256.replace(/^8/, '9');
    writeJson(d, 'media.json', media);
  }));
  assert.ok(
    rules(result, 'media-sha-unmatched').some((e) => e.path.startsWith('media.json[0]#')),
    JSON.stringify(result.errors),
  );
});

test('criterion 1: a record without license or credit fails the media schema', () => {
  for (const field of ['license', 'credit']) {
    const result = validatePackage(copiedTree((d) => {
      const media = readJson(d, 'media.json');
      delete media[0][field];
      writeJson(d, 'media.json', media);
    }));
    assert.ok(
      result.errors.some((e) => e.rule === 'required' && e.path.startsWith('media.json[0]#') && e.path.endsWith(`.${field}`)),
      `${field}: ${JSON.stringify(result.errors)}`,
    );
  }
});

test('criterion 1: dangling name_audio_refs and a foreign record voice are named diagnostics', () => {
  const danglingRef = validatePackage(copiedTree((d) => {
    const places = readJson(d, 'places.json');
    places[0].name_audio_refs = { be: 'media-ghost' };
    writeJson(d, 'places.json', places);
  }));
  assert.ok(
    rules(danglingRef, 'unknown-ref').some((e) => e.path === 'places.json[0].name_audio_refs.be#media-ghost'),
    JSON.stringify(danglingRef.errors),
  );
  const foreignVoice = validatePackage(copiedTree((d) => {
    const media = readJson(d, 'media.json');
    media[0].voice_id = 'voice-en-1';
    writeJson(d, 'media.json', media);
  }));
  assert.ok(
    rules(foreignVoice, 'voice-locale-mismatch').some((e) => e.path === 'media.json[0]'),
    JSON.stringify(foreignVoice.errors),
  );
});

test('criterion 3: an auto-trigger field cannot pass the moment schema', () => {
  const result = validatePackage(copiedTree((d) => {
    const moments = readJson(d, 'moments.json');
    moments[0].auto_trigger = true;
    writeJson(d, 'moments.json', moments);
  }));
  assert.ok(
    result.errors.some((e) => e.rule === 'additionalProperties' && e.path.startsWith('moments.json[0]#')),
    JSON.stringify(result.errors),
  );
});

test('criterion 1: a record must not drift from the covered file bytes or locale', () => {
  const staleBytes = validatePackage(copiedTree((d) => {
    const media = readJson(d, 'media.json');
    media[0].bytes += 1;
    writeJson(d, 'media.json', media);
  }));
  assert.ok(
    rules(staleBytes, 'media-bytes-mismatch').some((e) => e.path === 'media.json[0]'),
    JSON.stringify(staleBytes.errors),
  );
  const media = readJson(DEMO, 'media.json');
  const enIndex = media.findIndex((record) => record.media_id === 'media-story-1-base-en');
  const foreignLocale = validatePackage(copiedTree((d) => {
    const records = readJson(d, 'media.json');
    records[enIndex].locale = 'be';
    delete records[enIndex].voice_id;
    writeJson(d, 'media.json', records);
  }));
  assert.ok(
    rules(foreignLocale, 'media-locale-mismatch').some((e) => e.path === `media.json[${enIndex}]`),
    JSON.stringify(foreignLocale.errors),
  );
});

test('committed bad packages fail with exactly their named diagnostic', async () => {
  // The crafted fixtures are committed data, not test-time constructs: the
  // suite guards them directly so a silent edit cannot rot the demo.
  const validatorCases = [
    ['g0304-unlicensed-media', 'unlicensed-media'],
    ['g0304-moment-auto', 'additionalProperties'],
  ];
  for (const [dir, rule] of validatorCases) {
    const result = validatePackage(path.resolve(DEMO, '..', dir));
    assert.equal(result.ok, false, dir);
    assert.deepEqual(
      result.errors.map((e) => e.rule),
      [rule],
      dir,
    );
  }
  // The preview-leak package passes the validator on purpose — the packer is
  // the last line for that criterion.
  const leak = path.resolve(DEMO, '..', 'g0304-preview-leak');
  assert.deepEqual(validatePackage(leak), { ok: true, errors: [], warnings: [] });
  const out = await fsp.mkdtemp(path.join(os.tmpdir(), 'g0304-fixture-'));
  await assert.rejects(
    buildBundle({ inDir: leak, outDir: out }),
    (error) => error instanceof BuildError && error.code === 'preview-reveals-full-text',
  );
});

test('criterion 3: moment refs, duplicate ids and corrupt manifests are diagnostics', () => {
  const ghostRefs = validatePackage(copiedTree((d) => {
    const moments = readJson(d, 'moments.json');
    moments[0].place_id = 'place-ghost';
    moments[0].story_id = 'story-ghost';
    writeJson(d, 'moments.json', moments);
  }));
  const refs = rules(ghostRefs, 'unknown-ref').map((e) => e.path);
  assert.ok(refs.includes('moments.json[0]#place_id#place-ghost'), JSON.stringify(ghostRefs.errors));
  assert.ok(refs.includes('moments.json[0]#story_id#story-ghost'), JSON.stringify(ghostRefs.errors));

  const duplicate = validatePackage(copiedTree((d) => {
    const moments = readJson(d, 'moments.json');
    moments.push({ ...moments[0] });
    writeJson(d, 'moments.json', moments);
  }));
  assert.ok(rules(duplicate, 'duplicate-id').length > 0, JSON.stringify(duplicate.errors));

  const corrupt = validatePackage(copiedTree((d) => {
    fs.writeFileSync(path.join(d, 'moments.json'), '{not json');
  }));
  assert.ok(rules(corrupt, 'invalid-json').some((e) => e.path === 'moments.json'), JSON.stringify(corrupt.errors));

  const nullElement = validatePackage(copiedTree((d) => {
    const moments = readJson(d, 'moments.json');
    moments.push(null);
    writeJson(d, 'moments.json', moments);
  }));
  assert.ok(
    nullElement.errors.some((e) => e.rule === 'type' && e.path.startsWith('moments.json')),
    JSON.stringify(nullElement.errors),
  );
});

test('criterion 2: a story whose tier contradicts its layer fails the build', async () => {
  const work = copiedTree((d) => {
    const stories = readJson(d, 'be/base/stops.json');
    stories[0].tier = 'extended';
    writeJson(d, 'be/base/stops.json', stories);
  });
  const out = await fsp.mkdtemp(path.join(os.tmpdir(), 'g0304-build-'));
  await assert.rejects(
    buildBundle({ inDir: work, outDir: out }),
    (error) => error instanceof BuildError && error.code === 'story-tier-mismatch',
  );
});

test('criterion 2: a locked preview carrying the full story text fails the build', async () => {
  const work = copiedTree((d) => {
    const route = readJson(d, 'route.json');
    const story = readJson(d, 'be/extended/stops.json')[0];
    route.stops.find((stop) => stop.id === 'stop-2').preview.announce.be = story.text;
    writeJson(d, 'route.json', route);
  });
  const out = await fsp.mkdtemp(path.join(os.tmpdir(), 'g0304-build-'));
  await assert.rejects(
    buildBundle({ inDir: work, outDir: out }),
    (error) => error instanceof BuildError && error.code === 'preview-reveals-full-text' &&
      error.ids.stop_id === 'stop-2' && error.ids.locale === 'be' && error.ids.field === 'announce',
  );
});

test('criterion 2: the containment check catches a story too short for the 8-gram window', async () => {
  const work = copiedTree((d) => {
    const stories = readJson(d, 'be/extended/stops.json');
    stories[0].text = 'Кароткая платная гісторыя';
    writeJson(d, 'be/extended/stops.json', stories);
    const route = readJson(d, 'route.json');
    route.stops.find((stop) => stop.id === 'stop-2').preview.announce.be = 'Кароткая платная гісторыя.';
    writeJson(d, 'route.json', route);
  });
  const out = await fsp.mkdtemp(path.join(os.tmpdir(), 'g0304-build-'));
  await assert.rejects(
    buildBundle({ inDir: work, outDir: out }),
    (error) => error instanceof BuildError && error.code === 'preview-reveals-full-text',
  );
});

test('criterion 4: audio claimed without text is audio-without-text', () => {
  const index = JSON.parse(fs.readFileSync(path.resolve(DEMO, '..', '..', 'discovery-contract/index-valid.json'), 'utf8'));
  const offer = index.offers.find((entry) => entry.offer_id === 'offer-b1-guide');
  offer.availability.text_locales = ['be'];
  const at = index.offers.indexOf(offer);
  const result = validateDiscoveryIndex(index);
  assert.ok(
    rules(result, 'audio-without-text').some((e) => e.path === `discovery.json#offers[${at}].availability.audio_locales#en`),
    JSON.stringify(result.errors),
  );
});

test('criterion 4: built artifacts never claim audio for a text-only locale', async () => {
  const work = copiedTree((d) => {
    fs.rmSync(path.join(d, 'en', 'base', 'audio'), { recursive: true, force: true });
    fs.rmSync(path.join(d, 'en', 'extended', 'audio'), { recursive: true, force: true });
  });
  const out = await fsp.mkdtemp(path.join(os.tmpdir(), 'g0304-build-'));
  await buildBundle({ inDir: work, outDir: out });
  const revision = readJson(work, 'discovery.json').revision;
  const index = readJson(out, `public/discovery/demo-city/${revision}/index.json`);
  const guide = index.offers.find((offer) => offer.ref.kind === 'guide');
  // The index availability is the only artifact that claims audio: `en`
  // stays in text_locales (09 §8 publishes text per locale) and cannot
  // appear in audio_locales. The catalog carries no audio field at all; the
  // demo docs/demos/2026-09-26-g0304-media-moments-checks.md shows the
  // catalog derivation (locales by fact) beside this index.
  assert.deepEqual(guide.availability.audio_locales, ['be'], JSON.stringify(guide.availability));
  assert.ok(guide.availability.text_locales.includes('en'), JSON.stringify(guide.availability));
});

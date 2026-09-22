// G06.08 prototype guards: the walkthrough must keep demonstrating the
// accepted contracts (fail on revert), the fixture copy must stay a verbatim
// copy of the canonical fixture, the synthetic data must keep feeding the
// normative model, and the shared static server must contain paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runAll, runWalk, runDiscovery, runFeedback } from '../prototype/walkthrough.mjs';
import { selectDiscovery } from '../../../core/discovery/selectDiscovery.ts';
import { resolveStaticFile } from '../../../tools/serve-static.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const spike = path.resolve(here, '..');
const root = path.resolve(spike, '../..');
const index = JSON.parse(readFileSync(path.join(spike, 'data/discovery-index.json'), 'utf8'));
const city = JSON.parse(readFileSync(path.join(spike, 'data/synthetic-city.json'), 'utf8'));

test('discovery-index.json is a verbatim copy of the canonical fixture', () => {
  const copy = readFileSync(path.join(spike, 'data/discovery-index.json'), 'utf8');
  const canon = readFileSync(path.join(root, 'fixtures/discovery-contract/index-valid.json'), 'utf8');
  assert.equal(copy, canon, 'the prototype data copy drifted from fixtures/discovery-contract/index-valid.json');
});

test('criterion-1 walkthrough keeps the whole chain on the accepted model', () => {
  const lines = runWalk();
  const joined = lines.join('\n');
  for (const marker of ['locked', 'playing', 'pending', 'played', 'available'])
    assert.ok(['marker stop-1=', 'marker stop-2=', 'marker=', 'stop-3 '].some((p) => joined.includes(p + marker)),
      `marker ${marker} missing from the walkthrough`);
  const line = (prefix) => lines.find((l) => l.startsWith(prefix));
  assert.match(line('5 PlayMoment'), /guide stopped by command, queue retired to auto_fired \(true\), suspended=true/);
  assert.match(line('6 «Працягнуць гід»'), /«Працягнуць гід»: suspended=false/);
  assert.match(line('5 PlayMoment'), /heard=\[\] \(moment never credits guide\)/);
  assert.match(line('8 AccessReady'), /AccessReady extended \(upgrade\): stop-3 pending now unlocked.*no Play issued=true/);
  assert.match(line('9 Extended'), /keeps the live pause, ResumeAudio resumes the same token/);
  assert.match(line('10 Pause walk'), /Pause walk: state=Paused/);
  const end = line('12 End');
  assert.ok(end.includes('["story-free-1-base","story-free-3-ext"]'), `missed() must list story units: ${end}`);
  assert.match(line('13 R07'), /R07 quiet hint target: route-free-2 free/);
  assert.match(line('14 R07 eligibility'), /playing=false, paused=false, suspended=false, idle=true/);
});

test('discovery walkthrough demonstrates D03/D04/D05 through the real selector', () => {
  const lines = runDiscovery();
  assert.ok(lines.some((l) => l.startsWith('D03@60:') && l.includes('b1=over_time')), 'D03 60-min exclusion missing');
  assert.ok(lines.some((l) => l.startsWith('D04') && l.includes('exact=[]') && l.includes('differences') === false && l.includes('over_time')), 'D04 zero exact with labeled alternatives missing');
  assert.ok(lines.some((l) => l.startsWith('D05 autumn: exact=[offer-h1-place]')), 'D05 season scenario missing');
  // Direct selector check on the copy: reverting the label rule must fail here.
  const at60 = selectDiscovery(index, { city_id: 'city-a', content_locale: 'be', max_minutes: 60, theme_ids: ['theme-history'] });
  assert.ok(!at60.exact.some((m) => m.offer_id === 'offer-b1-guide'), 'paid 45–75 guide must not be exact at 60 minutes');
  const b1 = at60.alternatives.find((m) => m.offer_id === 'offer-b1-guide');
  assert.deepEqual(b1.differences, ['over_time']);
});

test('L01 availability fact: uk text without uk audio in the accepted fixture', () => {
  const b1 = index.offers.find((o) => o.offer_id === 'offer-b1-guide');
  assert.deepEqual(b1.availability, { text_locales: ['be', 'en', 'uk'], audio_locales: ['be', 'en'] });
  assert.ok(runDiscovery().some((l) => l.startsWith('L01') && l.includes('audio=be,en')));
});

test('feedback walkthrough names the client states and reason codes of 21 §5', () => {
  const text = runFeedback().join('\n');
  for (const state of ['draft', 'pending', 'sending', 'sent', 'conflict', 'action_required'])
    assert.ok(text.includes(state), `feedback state ${state} missing`);
  for (const reason of ['interesting_stories', 'audio_problem', 'worth_visiting', 'hard_to_reach'])
    assert.ok(text.includes(reason), `reason code ${reason} missing from the form contract`);
});

test('synthetic city feeds the model: paid-only stop has no base story', () => {
  const free = city.guides[0];
  const stop3 = free.stops.find((s) => s.id === 'stop-3');
  assert.equal(stop3.stories.some((st) => st.tier === 'base'), false, 'paid-only stop must stay base-less (ADR G01.01 §4.4)');
  const stop1 = free.stops.find((s) => s.id === 'stop-1');
  assert.deepEqual(stop1.stories.map((st) => st.tier).sort(), ['base', 'extended']);
  for (const guide of city.guides)
    for (const stop of guide.stops)
      assert.ok(stop.stories.length >= 1 && stop.stories.some((st) => st.role === 'primary'), `${guide.route_id}/${stop.id} needs a primary story`);
});

test('shared static server contains traversal before touching the disk', () => {
  const rootDir = path.join(spike, 'prototype');
  assert.equal(resolveStaticFile(rootDir, '/../package/screens.md'), null, 'dot-segment traversal must be rejected');
  assert.equal(resolveStaticFile(rootDir, '/%2e%2e/package/screens.md'), null, 'percent-encoded traversal must be rejected');
  const ok = resolveStaticFile(rootDir, '/app.js');
  assert.ok(ok && ok.startsWith(rootDir + path.sep) && ok.endsWith('app.js'));
  assert.ok(resolveStaticFile(rootDir, '/').endsWith('index.html'));
});

test('both byte-compared fixture paths keep the pinned eol=lf (rule 4)', () => {
  // Reverting the .gitattributes pins must fail here: on a CRLF checkout the
  // byte-compare guard would otherwise silently mask or falsely report drift.
  const raw = execFileSync('git', ['check-attr', '-z', 'eol', '--',
    'fixtures/discovery-contract/index-valid.json',
    'spikes/G06.08-prototype/data/discovery-index.json'], { cwd: root, encoding: 'utf8' });
  const fields = raw.split('\0');
  for (const pinned of ['fixtures/discovery-contract/index-valid.json', 'spikes/G06.08-prototype/data/discovery-index.json']) {
    const at = fields.indexOf(pinned);
    assert.ok(at !== -1, `git check-attr reported an entry for ${pinned}`);
    assert.equal(fields[at + 2], 'lf', `eol must stay lf for ${pinned}`);
  }
});

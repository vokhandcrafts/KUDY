import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Implementation-rules 1: PR #107 review round 1. Each assertion fails when its
// fixed line reverts to the pre-review wording — G03.05 blanket-gating all G10
// development, a rendered-output leak guard in G10.01.a, an R08 citation
// pointing at 01 instead of its canonical home in 15, or a closed #55
// described as WIP.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const readLines = (rel) => read(rel).split('\n');

test('guard: backlog G10 line scopes G03.05 to the public launch', () => {
  const line = readLines('docs/16_delivery_backlog.md')
    .find((l) => l.includes('вэб-трэк') && l.includes('G03.05'));
  assert.ok(line, 'the web-track update line must keep naming G03.05');
  assert.match(line, /G10\.02\.b|публічны запуск/, 'G03.05 gates only G10.02.b (public launch), not development');
  assert.doesNotMatch(line, /G01\.04 і G03\.05/, 'the blanket "G01.04 і G03.05" blocker returned');
});

test('guard: agent-tasks README third wave scopes G03.05 to G10.02.b', () => {
  const line = readLines('docs/agent-tasks/README.md')
    .find((l) => l.includes('вэб-каналу G10') && l.includes('G03.05'));
  assert.ok(line, 'the third-wave line must keep naming the G10 web channel');
  assert.match(line, /G10\.02\.b|публічны запуск/, 'G03.05 gates only G10.02.b (public launch), not development');
  assert.doesNotMatch(line, /G01\.04, G03\.05/, 'the blanket "(G02.03 #55, G01.04, G03.05)" blocker returned');
});

test('guard: G10.01.a leak guard stays content-input only', () => {
  const brief = read('docs/agent-tasks/web/G10.01.a.md');
  assert.match(brief, /content input only/, 'the leak guard must be scoped to content input');
  assert.doesNotMatch(brief, /content input and rendered output/, 'rendered-output scanning returned; it belongs to G10.01.b step 6');
});

test('guard: the web plan cites R08 at its canonical home (15)', () => {
  const plan = read('docs/plans/2026-09-16-web-audio-version.md');
  assert.match(plan, /\(15, R08\)/, 'R08 must be cited via 15, its canonical home');
  assert.doesNotMatch(plan, /\(01, R08\)/, 'the (01, R08) citation returned');
});

test('guard: closed G02.03 is not described as WIP in the G10 docs', () => {
  for (const rel of ['docs/plans/2026-09-16-web-audio-version.md', 'docs/agent-tasks/web/README.md']) {
    assert.doesNotMatch(read(rel), /WIP on branch `zcode\/55`|WIP на `zcode\/55`/, `${rel} still describes #55 as WIP (closed by PR #105)`);
  }
});

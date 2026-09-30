// G06.10.e (issue #405) — the determinism and shape guard of the paper-grain
// tile (canon texture.paper-grain): regenerating from the committed seed
// rebuilds the committed asset's pixels, every pixel is opaque (the 4–5%
// lives in the layer token, not baked into the tile), and the tile keeps
// its recorded size. Swapping the asset for a third-party file, changing
// the seed or the algorithm turns this red (implementation-rules 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';

import { SEED, TILE, encodeTile, tilePixels } from './gen-paper-grain.mjs';

const root = join(import.meta.dirname, '..', '..');
const assetPath = join(root, 'assets', 'paper-grain.png');

test('regenerating from the seed rebuilds the committed tile pixels', () => {
  const committed = PNG.sync.read(readFileSync(assetPath));
  const fresh = PNG.sync.read(encodeTile());
  assert.equal(fresh.width, TILE, `tile width must stay ${TILE}`);
  assert.equal(fresh.height, TILE, `tile height must stay ${TILE}`);
  assert.deepEqual(fresh.data, committed.data,
    'assets/paper-grain.png must equal the generator output — a foreign or stale asset fails here');
});

test('the committed CLI script writes the same pixels to any target', () => {
  const dir = mkdtempSync(join(tmpdir(), 'g0610e-grain-'));
  try {
    const out = join(dir, 'paper-grain.png');
    execFileSync(process.execPath, [join(root, 'tools', 'design', 'gen-paper-grain.mjs'), out]);
    const committed = PNG.sync.read(readFileSync(assetPath));
    assert.deepEqual(PNG.sync.read(readFileSync(out)).data, committed.data);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every tile pixel is opaque — the 4–5% belongs to the layer token', () => {
  const pixels = tilePixels(SEED, TILE);
  for (let i = 3; i < pixels.length; i += 4) {
    assert.equal(pixels[i], 255, 'tile alpha must stay 255 everywhere');
  }
});

test('the pixels depend on the seed — the determinism has teeth', () => {
  // A different seed must produce a different tile, or the determinism
  // check above would pass on a constant-image generator too.
  const base = tilePixels(SEED, TILE);
  const other = tilePixels(SEED + 1, TILE);
  let same = 0;
  for (let i = 0; i < base.length; i += 4) {
    if (base[i] === other[i] && base[i + 1] === other[i + 1] && base[i + 2] === other[i + 2]) same += 1;
  }
  assert.ok(same < TILE * TILE,
    `seed ${SEED + 1} must not reproduce the seed-${SEED} tile (${same}/${TILE * TILE} pixels equal)`);
});

test('the grain suite is wired into npm test (implementation-rules 1 and 7)', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /tools\/design\/\*\.test\.mjs/,
    'npm test must run tools/design/gen-paper-grain.test.mjs');
});

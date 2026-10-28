import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import pngjs from 'pngjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const { PNG } = pngjs;
function image(name) {
  return PNG.sync.read(readFileSync(join(root, 'assets/kudy-icon', name)));
}
function pixel(png, x, y) {
  const offset = (y * png.width + x) * 4;
  return [...png.data.subarray(offset, offset + 4)];
}
function copper([r, g, b, a]) {
  return a > 240 && r > 110 && r < 205 && g < 130 && b < 110;
}

test('square launcher frame reaches the output edges (not an inset painted frame)', () => {
  const png = image('icon.png');
  assert.equal(png.width, 1024);
  assert.equal(png.height, 1024);
  for (const [x, y] of [[2, 512], [1021, 512], [512, 2], [512, 1021]]) {
    assert.ok(copper(pixel(png, x, y)), `square border inset at ${x},${y}`);
  }
});

test('round adaptive border occupies the Android masked viewport edge', () => {
  const png = image('android-adaptive-foreground.png');
  assert.equal(png.width, 1024);
  assert.equal(png.height, 1024);
  // 72/108 of a 1024 adaptive foreground = approximately 683 pixels visible.
  // The copper ring must cross the mask perimeter at radius 337-342.
  assert.ok(copper(pixel(png, 844, 512)), 'the copper ring sits inside an empty outer halo');
  assert.equal(pixel(png, 925, 512)[3], 0, 'the extra area outside the mask stays transparent');
});

test('square adaptive foreground is not the round image and fills its square mask', () => {
  const png = image('android-adaptive-square-foreground.png');
  assert.equal(png.width, 1024);
  assert.equal(png.height, 1024);
  assert.ok(copper(pixel(png, 173, 512)));
  assert.ok(copper(pixel(png, 844, 512)));
  assert.equal(pixel(png, 100, 512)[3], 0);
  assert.equal(pixel(png, 924, 512)[3], 0);
});

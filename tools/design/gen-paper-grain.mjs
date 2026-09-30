// G06.10.e (issue #405) — the committed generator of the paper-grain tile
// (canon texture.paper-grain: a generated tiled asset at 4–5% over
// color.paper). One-shot, seed-deterministic: the same script and seed
// rebuild the byte-identical pixels of assets/paper-grain.png — no
// third-party file enters the repo, and swapping the asset for an outside
// one turns tools/design/gen-paper-grain.test.mjs red.
//
// The noise character follows the founder-approved reference
// spikes/2026-09-29-style-showcase.html (preset B «Зярно 4–5%»): SVG
// feTurbulence fractalNoise, baseFrequency 0.85, 2 octaves, opacity 0.05
// over the paper. That is ~pixel-wavelength noise with a softer octave
// beneath; this script approximates it with two octaves of seeded value
// noise (cell 2px smoothstep-interpolated + cell 1px), each channel R, G, B
// drawn independently — the slight per-channel shimmer is the paper-fiber
// feel of the reference. The 4–5% lives in the layer style
// (components/design-tokens.ts, texturePaperGrainOpacity), not in the tile:
// every pixel is opaque, so the guard can pin the opacity token alone.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

export const SEED = 20260930;
export const TILE = 180;
const OUT_DEFAULT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../assets/paper-grain.png",
);

// mulberry32: a small integer-seeded PRNG whose whole state is the 32-bit
// seed — no Node-version or platform entropy anywhere in the pipeline.
const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// One octave of value noise: a seeded lattice at cellSize px, sampled with
// smoothstep bilinear interpolation. cellSize 1 degenerates to white noise
// (the lattice point is the pixel), which is what the reference's top
// octave looks like at baseFrequency 0.85.
const octave = (size, cellSize, rng) => {
  const cells = Math.ceil(size / cellSize) + 1;
  const lattice = Array.from({ length: cells * cells }, () => rng());
  const smooth = (t) => t * t * (3 - 2 * t);
  const at = (x, y) => {
    const gx = x / cellSize;
    const gy = y / cellSize;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = smooth(gx - x0);
    const fy = smooth(gy - y0);
    const v = (cx, cy) => lattice[cy * cells + cx];
    const top = v(x0, y0) * (1 - fx) + v(x0 + 1, y0) * fx;
    const bottom = v(x0, y0 + 1) * (1 - fx) + v(x0 + 1, y0 + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };
  return at;
};

// Fixed draw order (octave, channel) keeps every channel independent of
// the others yet reproducible: the same seed always redraws the same six
// lattices in the same order.
export function tilePixels(seed = SEED, size = TILE) {
  const rng = mulberry32(seed);
  const channels = [0, 1, 2].map(() => [octave(size, 2, rng), octave(size, 1, rng)]);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        // 0.6/0.4 mixes the two octaves to the reference's fractal feel.
        const noise = 0.6 * channels[c][0](x, y) + 0.4 * channels[c][1](x, y);
        pixels[i + c] = Math.round(noise * 255);
      }
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

export function encodeTile(seed = SEED, size = TILE) {
  const png = new PNG({ width: size, height: size });
  tilePixels(seed, size).copy(png.data, 0, 0, size * size * 4);
  return PNG.sync.write(png);
}

const target = process.argv[2] ?? OUT_DEFAULT;
const bytes = encodeTile();
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, bytes);
console.log(
  `${target}: ${TILE}x${TILE} seed ${SEED} sha256 ${createHash("sha256").update(bytes).digest("hex")}`,
);

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const source = await readFile(new URL('map-cutout-v2.png', import.meta.url));
const png = PNG.sync.read(source);
assert.equal(png.width, 1351);
assert.equal(png.height, 1164);
for (const index of [0, png.width - 1, (png.height - 1) * png.width, png.width * png.height - 1]) {
  assert.equal(png.data[index * 4 + 3], 0, 'PNG corners must be transparent');
}
assert(png.data[(Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4 + 3] > 240,
  'The city interior must remain visible');
const svg = await readFile(new URL('map-cutout-v2.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1450, height: 1350 } });
  const extracted = await page.evaluate(text => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    if (doc.querySelector('parsererror, script, foreignObject')) throw new Error('Invalid or active SVG');
    for (const node of doc.querySelectorAll('[href]')) {
      const href = node.getAttribute('href');
      if (!href.startsWith('#') && !href.startsWith('data:image/png;base64,')) throw new Error('External SVG resource');
    }
    return { viewBox: doc.documentElement.getAttribute('viewBox'),
      image: doc.querySelector('#map-image')?.getAttribute('href'),
      outline: doc.querySelector('#outer-outline')?.getAttribute('d') };
  }, svg);
  assert.equal(extracted.viewBox, '0 0 1351 1164');
  assert(extracted.outline?.startsWith('M'));
  assert(Buffer.from(extracted.image.split(',')[1], 'base64').equals(source), 'Embedded PNG must be unchanged');
  await page.goto(new URL('cutout-preview.html', import.meta.url).href);
  await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  const target = page.locator('#parity-check');
  await target.evaluate(image => { image.style.width = '1351px'; image.style.maxWidth = 'none'; });
  const first = PNG.sync.read(await target.screenshot());
  await target.evaluate(image => { image.src = 'map-cutout-v2.svg'; return image.decode(); });
  const second = PNG.sync.read(await target.screenshot());
  assert(first.data.equals(second.data), 'Native-size PNG/SVG render must match');
  console.log('Cutout v2: 1351x1164; alpha and SVG valid; embedded PNG unchanged; native-size render matches.');
} finally {
  await browser.close();
}

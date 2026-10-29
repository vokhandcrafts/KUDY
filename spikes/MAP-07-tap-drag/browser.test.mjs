import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createStaticServer } from '../../tools/serve-static.mjs';

// Opt-in browser proof; npm test still enumerates this suite and its skip reason.
test('MAP-07 browser: pointer, keyboard, cancellation, resize and touch scroll', {
  skip: process.env.MAP07_BROWSER !== '1' && 'Set MAP07_BROWSER=1; requires Playwright Chromium',
}, async () => {
  const server = createStaticServer(resolve(fileURLToPath(new URL('.', import.meta.url))));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.MAP07_CHROMIUM_PATH && { executablePath: process.env.MAP07_CHROMIUM_PATH }) });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const first = page.locator('#first');
    const soon = page.locator('#soon');
    const status = page.locator('#status');
    const center = async (element) => {
      const box = await element.boundingBox();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const drag = async (element, dx, dy) => {
      const start = await center(element);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + dx, start.y + dy, { steps: 5 });
      assert.equal(await element.getAttribute('data-picked'), '', 'drag should lift immediately, without waiting for long press');
      await page.mouse.up();
    };
    await first.click();
    assert.equal(await status.textContent(), 'Дзеянняў: 1');
    // The user should see a tiny grab/lift while holding still, before any drag.
    const heldAt = await center(first);
    await page.mouse.move(heldAt.x, heldAt.y);
    await page.mouse.down();
    assert.equal(await first.getAttribute('data-pressed'), '');
    await page.waitForFunction(() => {
      const piece = document.querySelector('#first');
      return piece.hasAttribute('data-picked') && Number.parseFloat(getComputedStyle(piece).scale) > 1.01;
    });
    assert.equal(await first.getAttribute('data-dragging'), null);
    await page.mouse.up();
    assert.equal(await first.getAttribute('data-picked'), null);
    assert.equal(await status.textContent(), 'Дзеянняў: 1', 'hold/release must not navigate');
    await page.waitForFunction(() => Number.parseFloat(getComputedStyle(document.querySelector('#first')).scale) === 1);
    const original = await first.boundingBox();
    await drag(first, 44, 30);
    await page.waitForFunction((originX) => {
      const x = document.querySelector('#first').getBoundingClientRect().x;
      return Math.abs(x - originX - 44) < .5;
    }, original.x);
    assert.equal(Math.round((await first.boundingBox()).x - original.x), 44);
    assert.equal(await status.textContent(), 'Дзеянняў: 1');
    const disabledCenter = await center(soon);
    await page.mouse.click(disabledCenter.x, disabledCenter.y);
    const beforeSoon = await soon.boundingBox();
    await drag(soon, -30, -20);
    await page.waitForFunction((originX) => {
      const x = document.querySelector('#soon').getBoundingClientRect().x;
      return Math.abs(x - originX + 30) < .5;
    }, beforeSoon.x);
    assert.equal(Math.round((await soon.boundingBox()).x - beforeSoon.x), -30);
    assert.equal(await status.textContent(), 'Дзеянняў: 1');
    await first.focus();
    await page.keyboard.press('Enter');
    assert.equal(await status.textContent(), 'Дзеянняў: 2');
    const start = await center(first);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.equal(await status.textContent(), 'Дзеянняў: 2');
    // Real capture loss must suppress the click that follows pointerup.
    await page.mouse.down();
    await first.evaluate((element) => element.releasePointerCapture(1));
    await page.mouse.move(start.x + 1, start.y + 1);
    await page.mouse.up();
    assert.equal(await status.textContent(), 'Дзеянняў: 2');
    // A burst in one event-loop task paints one transform, not one per sample.
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const paints = await first.evaluate(async (element) => {
      let count = 0;
      const observer = new MutationObserver((records) => { count += records.length; });
      observer.observe(element, { attributes: true, attributeFilter: ['style'] });
      const box = element.getBoundingClientRect();
      for (let dx = 10; dx <= 40; dx += 10) {
        element.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1,
          clientX: box.x + box.width / 2 + dx, clientY: box.y + box.height / 2, buttons: 1 }));
      }
      await new Promise((done) => requestAnimationFrame(done));
      observer.disconnect();
      return count;
    });
    assert.equal(paints, 1);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await drag(first, 2000, 2000);
    await page.setViewportSize({ width: 320, height: 568 });
    await page.waitForFunction(() => {
      const board = document.querySelector('#board').getBoundingClientRect();
      return [...document.querySelectorAll('.piece')].every((piece) => {
        const r = piece.getBoundingClientRect();
        return r.left >= board.left && r.right <= board.right && r.top >= board.top && r.bottom <= board.bottom;
      });
    });
    // Reload gives fixed geometry for real touch dispatch through Chromium.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    const cdp = await page.context().newCDPSession(page);
    const touch = async (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    const p = await center(first);
    await touch('touchStart', [{ ...p, id: 1 }]);
    await touch('touchStart', [{ ...p, id: 1 }, { x: 360, y: 400, id: 2 }]);
    await touch('touchEnd', []);
    assert.equal(await status.textContent(), 'Дзеянняў: 0');
    await page.touchscreen.tap(p.x, p.y);
    assert.equal(await status.textContent(), 'Дзеянняў: 1');
    await touch('touchStart', [{ ...p, id: 1 }]);
    await touch('touchMove', [{ x: p.x + 30, y: p.y + 25, id: 1 }]);
    await touch('touchEnd', []);
    assert.equal(await status.textContent(), 'Дзеянняў: 1');
    await page.waitForFunction((originalX) => {
      const rect = document.querySelector('#first').getBoundingClientRect();
      return Math.abs(rect.x + rect.width / 2 - originalX - 30) < .5;
    }, p.x);
    assert.equal(Math.round((await center(first)).x - p.x), 30);
    const board = await page.locator('#board').boundingBox();
    const x = board.x + board.width - 8;
    await touch('touchStart', [{ x, y: 650, id: 1 }]);
    for (let y = 630; y >= 350; y -= 20) await touch('touchMove', [{ x, y, id: 1 }]);
    await touch('touchEnd', []);
    await page.waitForFunction(() => window.scrollY > 50);
    assert.ok(await page.evaluate(() => window.scrollY > 50));
    // Reduced motion removes all visual movement cues, but leaves an accessible
    // static picked state and immediate gesture positioning.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    const reducedCenter = await center(first);
    await page.mouse.move(reducedCenter.x, reducedCenter.y);
    await page.mouse.down();
    await page.waitForFunction(() => document.querySelector('#first').hasAttribute('data-picked'));
    assert.equal(await first.evaluate((element) => getComputedStyle(element).scale), '1');
    assert.equal(await first.evaluate((element) => Number.parseFloat(getComputedStyle(element).translate)), 0);
    await page.mouse.up();
    assert.equal(await status.textContent(), 'Дзеянняў: 0');
    await first.focus();
    await page.keyboard.press('Enter');
    assert.equal(await status.textContent(), 'Дзеянняў: 1');
    assert.deepEqual(errors, []);
    if (process.env.MAP07_SCREENSHOT) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: process.env.MAP07_SCREENSHOT, fullPage: true });
    }
  } finally {
    await browser?.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

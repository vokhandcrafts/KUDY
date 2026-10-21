// Discovery's Android screen can have more offer cards than fit in one
// UIAutomator dump. Exercise real viewport-aware scrolling without an AVD.
import assert from 'node:assert/strict';
import test from 'node:test';

import { scrollTo } from './discovery.mjs';

const viewport = (id) => `<node resource-id="${id}" bounds="[44,345][1036,2230]"/>`;
const item = (id, bounds = '[44,900][1036,1360]', label = '') =>
  `<node resource-id="${id}" bounds="${bounds}" content-desc="${label}"/>`;

test('Discovery reaches an offscreen paid card and badge, then scrolls back to its filters', async () => {
  let atBottom = false;
  const swipes = [];
  const driver = {
    dump: async () => ({ xml: viewport('scroll-discovery') + (atBottom
      ? item('offer-card-offer-guide-e2e-paid') + item('badge-access-paid', '[70,1360][300,1410]', 'Платна')
      : item('time-60', '[394,428][616,560]') +
        item('offer-card-offer-guide-e2e-paid', '[44,2230][1036,2230]')) }),
    exec: async (args) => {
      swipes.push(args);
      atBottom = args[3] === '1853';
    },
  };
  assert.equal((await scrollTo(driver, 'offer-card-offer-guide-e2e-paid', 'paid')).resourceId,
    'offer-card-offer-guide-e2e-paid');
  assert.equal((await scrollTo(driver, 'badge-access-paid', 'badge')).contentDesc, 'Платна');
  assert.equal(swipes.length, 1, 'the visible badge needs no second scroll');
  assert.equal((await scrollTo(driver, 'time-60', 'time', { direction: 'up' })).resourceId, 'time-60');
  assert.deepEqual(swipes, [
    ['shell', 'input', 'swipe', '540', '1853', '540', '722', '350'],
    ['shell', 'input', 'swipe', '540', '722', '540', '1853', '350'],
  ]);
});

test('Discovery scroll helper supports the separate guide preview viewport', async () => {
  let visible = false;
  const swipes = [];
  const driver = {
    dump: async () => ({ xml: viewport('scroll-preview') +
      (visible ? item('btn-download') : item('preview-theme')) }),
    exec: async (args) => {
      swipes.push(args);
      visible = true;
    },
  };
  assert.equal((await scrollTo(driver, 'btn-download', 'download',
    { scrollID: 'scroll-preview' })).resourceId, 'btn-download');
  assert.equal(swipes.length, 1);
});

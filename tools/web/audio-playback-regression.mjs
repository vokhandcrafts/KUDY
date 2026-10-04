// G21.04 audio playback browser regressions (issue #537), strictly local.
//
// The real static export (web/out) is served from 127.0.0.1 and every
// external request is aborted — playback proves the committed synthetic
// fixture bytes, never a network asset. The named checks mirror the issue's
// Proof section and criteria:
//
// - export_paid_media_absent — the export ships no extended (paid) audio:
//   every .m4a in web/out sits under a base layer (criterion 2, the same
//   boundary web/lib/content leak-guard enforces on bundle data).
// - synthetic_audio_decodes — after a user click the audio element reports
//   finite positive duration with no MediaError (criterion 3; the reverted
//   85-byte KUDY-DEMO-AUDIO placeholder reports NaN instead).
// - playback_advances — on both bundle-locale tracks play succeeds and
//   currentTime advances before pause (criterion 3).
// - corrupt_asset_fails — a copy of the export whose be base audio is
//   replaced with an 85-byte placeholder-marker file raises a MediaError
//   and never advances (criterion 3, negative case).
//
// Usage: node tools/web/audio-playback-regression.mjs [--out <dir>] [--shots <dir>]
// Requires a current static export: `npm run build` in web/. Playwright
// resolves from the root node_modules; the chromium binary comes from
// `npx playwright install chromium` (not wired into the standard runner —
// the shared seam lives in regression-common.mjs, the collector's
// loadPlaywright pattern). The click is a real Playwright user gesture on
// the native controls' play button, so no autoplay-policy override is used.
import assert from 'node:assert/strict';
import { cpSync, existsSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadChromium, parseExportArgs, serveExport } from './regression-common.mjs';

const { outDir: OUT_DIR, shotsDir: SHOTS_DIR } = parseExportArgs(process.argv);

const STOP_PAGE = 'guides/demo-route-a1/stops/stop-1.html';
const BASE_AUDIO_BE = 'content/bundle/demo-route-a1/1/be/base/audio/story-1-base.m4a';

const playwright = await loadChromium();
assert.ok(existsSync(join(OUT_DIR, STOP_PAGE)), `web/out/${STOP_PAGE} is missing (${OUT_DIR}) — run \`npm run build\` in web/ first`);
assert.ok(existsSync(join(OUT_DIR, BASE_AUDIO_BE)), `web/out/${BASE_AUDIO_BE} is missing (${OUT_DIR}) — the export predates the synthetic audio fixture`);

if (SHOTS_DIR) await mkdir(SHOTS_DIR, { recursive: true });

// export_paid_media_absent: every .m4a in the export must sit under a
// `/base/` layer — an extended-tier audio file in web/out would leak paid
// media into the public static channel.
const m4aPaths = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) walk(abs);
    else if (abs.endsWith('.m4a')) m4aPaths.push(abs);
  }
};
walk(OUT_DIR);
const paidLeaks = m4aPaths.filter((abs) => !abs.split(/[\\/]/).includes('base'));
const checks = {
  export_paid_media_absent: {
    ok: paidLeaks.length === 0 && m4aPaths.length >= 2,
    details: { m4a_files: m4aPaths.length, paid_leaks: paidLeaks },
  },
};

const openStopPage = async (browser, base) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let blockedExternal = 0;
  await page.route('**/*', (route) => {
    if (route.request().url().startsWith(base)) return route.continue();
    blockedExternal += 1;
    return route.abort();
  });
  await page.goto(`${base}/${STOP_PAGE}`, { waitUntil: 'load' });
  await page.waitForSelector('audio[controls]', { timeout: 20000 });
  return { page, blockedExternal: () => blockedExternal };
};

// The native controls' play button sits at the left edge of the control bar;
// the click is the user gesture the acceptance criteria demand.
const clickPlay = (page, index) =>
  page.locator('audio[controls]').nth(index).click({ position: { x: 20, y: 16 } });

const poll = async (page, index, pageFn, timeoutMs = 6000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await page.locator('audio[controls]').nth(index).evaluate(pageFn)) return true;
    if (Date.now() > deadline) return false;
    await page.waitForTimeout(100);
  }
};

const browser = await playwright.chromium.launch();

// synthetic_audio_decodes + playback_advances on the real export: both
// bundle-locale base tracks on the free stop page.
let serve = null;
try {
  serve = await serveExport(OUT_DIR);
  const { page, blockedExternal } = await openStopPage(browser, serve.base);
  const trackCount = await page.locator('audio[controls]').count();
  const tracks = [];

  for (let index = 0; index < trackCount; index += 1) {
    await clickPlay(page, index);
    const decoded = await poll(
      page,
      index,
      (el) => Number.isFinite(el.duration) && el.duration > 0 && el.error === null,
    );
    const advanced = await poll(page, index, (el) => el.currentTime > 0.2 && !el.paused);
    const playing = await page
      .locator('audio[controls]')
      .nth(index)
      .evaluate((el) => ({ paused: el.paused, t: el.currentTime, duration: el.duration }));
    if (SHOTS_DIR) {
      await page.screenshot({ path: join(SHOTS_DIR, `audio-playing-track-${index}.png`), fullPage: true });
    }
    await page.locator('audio[controls]').nth(index).evaluate((el) => el.pause());
    const paused = await page.locator('audio[controls]').nth(index).evaluate((el) => el.paused);
    tracks.push({
      index,
      decoded,
      advanced,
      played_before_pause: !playing.paused && playing.t > 0.2,
      duration: playing.duration,
      paused_after_pause: paused,
    });
  }
  checks.synthetic_audio_decodes = {
    ok: trackCount === 2 && tracks.every((t) => t.decoded),
    details: { tracks, track_count: trackCount },
  };
  checks.playback_advances = {
    ok: tracks.every((t) => t.advanced && t.played_before_pause && t.paused_after_pause),
    details: { tracks, external_requests_blocked: blockedExternal() },
  };
  await page.close();
} catch (error) {
  for (const name of ['synthetic_audio_decodes', 'playback_advances']) {
    checks[name] = { ok: false, details: { error: error instanceof Error ? error.message : String(error) } };
  }
} finally {
  // A failure after the server started must still end the process — an
  // unclosed listener would hold the event loop and hang the verdict.
  serve?.close();
}

// corrupt_asset_fails: the same export with the be base audio replaced by an
// 85-byte placeholder-marker file — the negative case must be loud, never
// silence (a preload="none" asset is only fetched by the play click).
let corruptRoot = null;
let corruptServe = null;
try {
  corruptRoot = join(tmpdir(), `kudy-audio-corrupt-${process.pid}`);
  cpSync(OUT_DIR, corruptRoot, { recursive: true });
  writeFileSync(
    join(corruptRoot, BASE_AUDIO_BE),
    Buffer.concat([Buffer.from('KUDY-DEMO-AUDIO\n', 'utf8'), Buffer.alloc(48, 0x2b)]),
  );
  corruptServe = await serveExport(corruptRoot);
  const { page } = await openStopPage(browser, corruptServe.base);
  await clickPlay(page, 0);
  const failure = await page
    .waitForFunction(
      () => {
        const el = document.querySelector('audio[controls]');
        return el && el.error !== null;
      },
      undefined,
      { timeout: 10000 },
    )
    .then(
      () =>
        page.evaluate(() => {
          const el = document.querySelector('audio[controls]');
          return { mediaErrorCode: el.error && el.error.code, t: el.currentTime };
        }),
      () =>
        page.evaluate(() => {
          const el = document.querySelector('audio[controls]');
          return { error: 'no-media-error-in-10s', paused: el.paused, t: el.currentTime, duration: el.duration };
        }),
    );
  checks.corrupt_asset_fails = {
    ok: failure.mediaErrorCode !== undefined && failure.t === 0,
    details: failure,
  };
  await page.close();
} catch (error) {
  checks.corrupt_asset_fails = { ok: false, details: { error: error instanceof Error ? error.message : String(error) } };
} finally {
  if (corruptServe) corruptServe.close();
  if (corruptRoot) rmSync(corruptRoot, { recursive: true, force: true });
}

await browser.close();
console.log(JSON.stringify({ ok: Object.values(checks).every((c) => c.ok), checks }, null, 2));
const failed = Object.entries(checks).filter(([, c]) => !c.ok);
if (failed.length > 0) {
  console.error(`audio-playback regression failed: ${failed.map(([name]) => name).join(', ')}`);
  process.exitCode = 1;
}

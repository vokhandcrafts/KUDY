import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { UI_LOCALES, COMPLETE_UI_LOCALES } from '../../contracts/ui-locales.ts';
import { loadUiMessagesSource } from '../../contracts/ui-messages/ui-messages.mjs';
import { loadUiMessageTranslations } from '../../contracts/ui-messages/translations.mjs';
import { findNode, parseDump } from './driver.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = loadUiMessagesSource();
const catalogues = new Map();
const TIMEOUT_MS = 30000;

export function messageFor(locale, id) {
  assert.ok(COMPLETE_UI_LOCALES.includes(locale), `unknown UI locale: ${locale}`);
  if (!catalogues.has(locale)) {
    const records = locale === 'be' ? source.records : loadUiMessageTranslations(
      path.join(ROOT, 'contracts/ui-messages/translations', `${locale}.json`), source, COMPLETE_UI_LOCALES,
    ).records;
    catalogues.set(locale, new Map(records.map((record) => [record.id, locale === 'be' ? record.source : record.value])));
  }
  const value = catalogues.get(locale).get(id);
  assert.equal(typeof value, 'string', `missing plain message ${locale}:${id}`);
  return value;
}

function boundsOf(node) {
  const match = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(node?.bounds ?? '');
  assert.ok(match, `invalid bounds for ${node?.resourceId}`);
  const [left, top, right, bottom] = match.slice(1).map(Number);
  assert.ok(right > left && bottom > top, `empty bounds for ${node.resourceId}`);
  return { left, top, right, bottom };
}

export function checkAction(nodes, screenId, testID, label) {
  const node = findNode(nodes, { testID });
  assert.ok(node, `missing action ${testID}`);
  assert.equal(node.enabled, true, `${testID} must be enabled`);
  assert.equal(node.clickable, true, `${testID} must be clickable`);
  assert.equal(node.contentDesc, label, `${testID} content-desc`);
  const screen = boundsOf(findNode(nodes, { testID: screenId }));
  const button = boundsOf(node);
  assert.ok(button.left >= screen.left && button.top >= screen.top &&
    button.right <= screen.right && button.bottom <= screen.bottom, `${testID} bounds clipped outside ${screenId}`);
  return node;
}

export function checkSelection(nodes, locale) {
  const selected = nodes.filter((node) => node.resourceId.startsWith('btn-ui-locale-') && node.selected);
  assert.deepEqual(selected.map((node) => node.resourceId), [`btn-ui-locale-${locale}`], `selected locale must be ${locale}`);
  return selected[0];
}

export async function withLargeFont(driver, operation) {
  const original = (await driver.exec(['shell', 'settings', 'get', 'system', 'font_scale'])).stdout.trim();
  assert.ok(original === 'null' || (/^\d+(?:\.\d+)?$/.test(original) && Number(original) > 0), `invalid font_scale: ${original}`);
  let failure;
  try {
    await driver.exec(['shell', 'settings', 'put', 'system', 'font_scale', '1.5']);
    await operation();
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      await driver.exec(original === 'null'
        ? ['shell', 'settings', 'delete', 'system', 'font_scale']
        : ['shell', 'settings', 'put', 'system', 'font_scale', original]);
    } catch (error) {
      if (failure) throw new AggregateError([failure, error], 'suite failed and font_scale restoration failed');
      throw error;
    }
  }
}

async function screenNodes(driver, screenId, slug) {
  await driver.waitFor({ testID: screenId }, { timeoutMs: TIMEOUT_MS, dumpBasename: `dump-${slug}-wait.xml` });
  return parseDump((await driver.dump(`dump-${slug}.xml`)).xml);
}

async function openPicker(driver, slug) {
  await driver.launchDeepLink('kudy:///my');
  return screenNodes(driver, 'screen-KUDY', `${slug}-picker`);
}

async function selectLocale(driver, locale, slug) {
  const nodes = await openPicker(driver, slug);
  for (const entry of UI_LOCALES) {
    checkAction(nodes, 'screen-KUDY', `btn-ui-locale-${entry.code}`, entry.nativeName);
  }
  await driver.tapNode(findNode(nodes, { testID: `btn-ui-locale-${locale}` }));
  checkSelection(await screenNodes(driver, 'screen-KUDY', `${slug}-selected`), locale);
}

export async function runLocalesSuite({ driver, url, runCase, coldStart }) {
  await coldStart(driver, url, { timeoutMs: 420000, caseSlug: 'locales-boot' });
  const initial = (await openPicker(driver, 'locales-initial')).find((node) =>
    node.resourceId.startsWith('btn-ui-locale-') && node.selected);
  assert.ok(initial, 'initial UI locale is not selected');
  const originalLocale = initial.resourceId.slice('btn-ui-locale-'.length);
  await withLargeFont(driver, async () => {
    try {
      for (const { code } of UI_LOCALES) {
        const slug = `locale-${code}`;
        await runCase(`${code}: selection, restart, Explore labels and taps at font scale 1.5`, slug, driver, async () => {
          await selectLocale(driver, code, slug);
          await coldStart(driver, url, { timeoutMs: 180000, caseSlug: `${slug}-restart` });
          const nodes = await screenNodes(driver, 'screen-Explore', `${slug}-explore`);
          for (const [id, key, screen] of [
            ['link-nearby', 'nearby', 'screen-Map'],
            ['link-discovery', 'whatToDo', 'screen-Discovery'],
            ['link-kudy', 'kudyLink', 'screen-KUDY'],
          ]) {
            const action = checkAction(nodes, 'screen-Explore', id, messageFor(code, `native.chrome.${key}`));
            await driver.tapNode(action);
            await driver.waitFor({ testID: screen }, { timeoutMs: TIMEOUT_MS, dumpBasename: `dump-${slug}-${key}.xml` });
            if (id === 'link-kudy') checkSelection(await screenNodes(driver, screen, `${slug}-persisted`), code);
            await driver.back();
            await driver.waitFor({ testID: 'screen-Explore' }, { timeoutMs: TIMEOUT_MS });
          }
          await driver.screenshot(`${slug}-large-font.png`);
        });
        await runCase(`${code}: preview action and label at font scale 1.5`, `${slug}-preview`, driver, async () => {
          await selectLocale(driver, code, `${slug}-preview`);
          await driver.launchDeepLink('kudy:///route/e2e-free-guide');
          await driver.waitFor({ testID: 'preview-locales' }, { timeoutMs: TIMEOUT_MS });
          const nodes = await screenNodes(driver, 'screen-Route preview', `${slug}-preview-action`);
          const download = findNode(nodes, { testID: 'btn-download' });
          const id = download ? 'btn-download' : 'btn-start';
          const label = messageFor(code, `native.preview.label.${download ? 'download' : 'start'}`);
          checkAction(nodes, 'screen-Route preview', id, label);
          await driver.screenshot(`${slug}-preview-large-font.png`);
        });
      }

      await runCase('preview and live Run primary actions at font scale 1.5', 'locale-walk-actions', driver, async () => {
        await selectLocale(driver, 'be', 'locale-walk');
        await driver.launchDeepLink('kudy:///route/e2e-free-guide');
        let nodes = await screenNodes(driver, 'screen-Route preview', 'locale-preview');
        const download = findNode(nodes, { testID: 'btn-download' });
        if (download) {
          await driver.tapNode(checkAction(nodes, 'screen-Route preview', 'btn-download', messageFor('be', 'native.preview.label.download')));
          await driver.waitFor({ testID: 'btn-start' }, { timeoutMs: 120000, dumpBasename: 'dump-locale-downloaded.xml' });
          nodes = await screenNodes(driver, 'screen-Route preview', 'locale-preview-ready');
        }
        await driver.tapNode(checkAction(nodes, 'screen-Route preview', 'btn-start', messageFor('be', 'native.preview.label.start')));
        nodes = await screenNodes(driver, 'screen-Run', 'locale-run');
        // The fixture walk is pinned to be; switching UI locale cannot change its language (ADR G01.03).
        checkAction(nodes, 'screen-Run', 'btn-run-end', messageFor('be', 'native.run.endWalk'));
        await driver.tapNode(checkAction(nodes, 'screen-Run', 'btn-run-pause', messageFor('be', 'native.run.pauseWalk')));
        await driver.waitFor({ testID: 'btn-run-resume' }, { timeoutMs: TIMEOUT_MS });
        nodes = await screenNodes(driver, 'screen-Run', 'locale-run-paused');
        await driver.tapNode(checkAction(nodes, 'screen-Run', 'btn-run-resume', messageFor('be', 'native.run.resume')));
        await driver.waitFor({ testID: 'btn-run-pause' }, { timeoutMs: TIMEOUT_MS });
        await driver.tapSelector({ testID: 'btn-run-end' });
        await driver.waitFor({ testID: 'end-confirm-dialog' }, { timeoutMs: TIMEOUT_MS });
        await driver.tapSelector({ testID: 'btn-end-confirm-cancel' });
        await driver.screenshot('locale-run-large-font.png');
      });
    } finally {
      await selectLocale(driver, originalLocale, 'locales-restore');
    }
  });
}

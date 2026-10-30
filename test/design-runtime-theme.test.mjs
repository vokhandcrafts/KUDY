// #436 — reverting a dark override or root appearance wiring turns this red.
// This is a contract guard; native visual/device acceptance is separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCanon } from './design-canon.mjs';
import { tokens, darkTokens } from '../components/design-tokens.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const canon = loadCanon();
const runtimeToCanon = {
  colorPaper: 'color.paper',
  colorInk: 'color.ink',
  colorMuted: 'color.muted',
  colorAccent: 'color.accent',
  colorAccentInk: 'color.accent-ink',
  colorCard: 'color.card',
  colorLine: 'color.line',
  colorShelfAccent: 'color.shelf.accent',
  colorShelfLine: 'color.shelf.line',
  colorDisabledInk: 'color.disabled-ink',
  colorDisabledLine: 'color.disabled-line',
  colorBadgePaid: 'color.badge.paid',
  colorBadgeFree: 'color.badge.free',
  colorBadgeMixed: 'color.badge.mixed',
  colorNoticeBg: 'color.notice.bg',
  colorNoticeBorder: 'color.notice.border',
  colorErrorBg: 'color.error.bg',
  colorErrorBorder: 'color.error.border',
  colorHintBg: 'color.hint.bg',
  colorHintBorder: 'color.hint.border',
};

test('runtime palettes reflect the accepted DT-2 canon exactly', () => {
  for (const [key, canonKey] of Object.entries(runtimeToCanon)) {
    assert.equal(tokens[key], canon.tokens[canonKey].value, `light ${key}`);
    assert.equal(darkTokens[key], canon.darkTheme.tokens[canonKey], `dark ${key}`);
  }
  const overridden = Object.keys(tokens).filter((key) => tokens[key] !== darkTokens[key]);
  assert.deepEqual(overridden.sort(), Object.keys(runtimeToCanon).sort(),
    'every runtime override is accepted; no omitted or invented dark color');
});

test('DT-4 keeps the actual map and markers light in both modes', () => {
  for (const key of Object.keys(tokens).filter((key) =>
    key === 'colorMap' || key.startsWith('colorMarker'))) {
    assert.equal(darkTokens[key], tokens[key], `${key} must not change with appearance`);
  }
});

test('the root owns one reactive status bar; calm surfaces consume the live palette', () => {
  const rootLayout = readFileSync(join(root, 'app/_layout.tsx'), 'utf8');
  const paper = readFileSync(join(root, 'components/paper-surface.tsx'), 'utf8');
  const theme = readFileSync(join(root, 'components/theme.ts'), 'utf8');
  assert.match(theme, /useColorScheme\(\)/, 'native appearance must drive the hook');
  assert.match(rootLayout, /const theme = useThemeScheme\(\)/);
  assert.match(rootLayout, /<StatusBar style=\{statusBarStyle\(theme\)\} \/>/);
  assert.equal((rootLayout.match(/<StatusBar /g) ?? []).length, 1, 'one root status bar only');
  assert.match(paper, /backgroundColor: palette\.colorPaper/,
    'the calm screen must change its background when appearance changes');
});


test('Android appearance config installs the SDK 54 native plugin', () => {
  const config = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo;
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  assert.equal(config.userInterfaceStyle, 'automatic',
    'the native app must not lock dark-mode devices into light appearance');
  assert.ok(config.plugins.includes('expo-system-ui'),
    'the Android userInterfaceStyle setting requires the native Expo plugin');
  assert.equal(pkg.dependencies['expo-system-ui'], '~6.0.9',
    'use the module version compatible with Expo SDK 54');
  assert.equal(lock.packages[''].dependencies['expo-system-ui'], pkg.dependencies['expo-system-ui']);
  assert.equal(lock.packages['node_modules/expo-system-ui'].version, '6.0.9',
    'npm ci must install the native module without changing the lockfile');
});

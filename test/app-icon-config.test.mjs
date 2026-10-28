import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const { expo } = JSON.parse(readFileSync(join(repoRoot, 'app.json'), 'utf8'));

test('Expo config carries the accepted brand icon, adaptive layers and splash', () => {
  assert.equal(expo.icon, './assets/kudy-icon/icon.png');
  assert.equal(expo.ios.icon, './assets/kudy-icon/icon.png');
  assert.equal(expo.android.icon, './assets/kudy-icon/icon.png');
  assert.equal(
    expo.android.adaptiveIcon.foregroundImage,
    './assets/kudy-icon/android-adaptive-square-foreground.png',
  );
  assert.equal(
    expo.android.adaptiveIcon.backgroundImage,
    './assets/kudy-icon/android-adaptive-background.png',
  );
  assert.equal(expo.android.adaptiveIcon.backgroundColor, '#F5EDDF');
  assert.equal(expo.splash.image, './assets/kudy-icon/icon.png');
  assert.equal(expo.splash.resizeMode, 'contain');
  assert.equal(expo.splash.backgroundColor, '#F5EDDF');
  assert.ok(expo.plugins.includes('./tools/android-build/with-shape-aware-icons.cjs'));
});

test('every configured brand asset file exists in the repository', () => {
  const configured = [
    expo.icon,
    expo.ios.icon,
    expo.android.icon,
    expo.android.adaptiveIcon.foregroundImage,
    './assets/kudy-icon/android-adaptive-foreground.png',
    expo.android.adaptiveIcon.backgroundImage,
    expo.splash.image,
  ];
  for (const configuredPath of configured) {
    assert.match(configuredPath, /^\.\/assets\/kudy-icon\//);
    const absolute = join(repoRoot, configuredPath.slice(2));
    assert.ok(existsSync(absolute), 'missing brand asset: ' + configuredPath);
  }
});

test('demo build keeps its own icon and does not inherit the production adaptive icon', () => {
  const stdout = execFileSync(
    process.execPath,
    ['-e', 'process.stdout.write(JSON.stringify(require("./app.config.js").expo))'],
    { cwd: repoRoot, env: { ...process.env, EXPO_PUBLIC_DEMO_MODE: '1' }, encoding: 'utf8' },
  );
  const demo = JSON.parse(stdout);
  assert.equal(demo.name, 'KUDY Demo');
  assert.equal(demo.icon, './assets/demo-icon.png');
  assert.equal(demo.android.package, 'by.kudy.app.demo');
  assert.equal(demo.android.icon, './assets/demo-icon.png');
  assert.equal(demo.android.adaptiveIcon, undefined);
  assert.equal(demo.ios.icon, './assets/demo-icon.png');
  assert.deepEqual(
    demo.splash,
    expo.splash,
    'demo intentionally inherits the brand splash',
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const generate = `
  const { createRequire } = require('node:module');
  const { dirname, join } = require('node:path');
  const { mkdtempSync, rmdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const cli = createRequire(require.resolve('@expo/cli/package.json', {
    paths: [dirname(require.resolve('expo/package.json'))],
  }));
  (async () => {
    const { exp } = await cli('@expo/prebuild-config').getPrebuildConfigAsync(process.cwd(), { platforms: ['android'] });
    const projectRoot = mkdtempSync(join(tmpdir(), 'kudy-android-manifest-'));
    try {
      const generated = await cli('@expo/config-plugins').compileModsAsync(exp, {
        projectRoot, platforms: ['android'], introspect: true,
      });
      console.log(JSON.stringify(generated._internal.modResults.android.manifest.manifest));
    } finally { rmdirSync(projectRoot); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
`;
// Existing prebuild output must not hide a reverted permission or plugin.
const manifest = JSON.parse(execFileSync(process.execPath, ['-e', generate], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, EXPO_NO_DOTENV: '1', EXPO_NO_TELEMETRY: '1', EXPO_OFFLINE: '1', EXPO_PUBLIC_DEMO_MODE: '' },
  maxBuffer: 10 * 1024 * 1024,
}));
const permissions = manifest['uses-permission'];

for (const permission of [
  'RECORD_AUDIO', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE',
  'SYSTEM_ALERT_WINDOW', 'FOREGROUND_SERVICE_MICROPHONE',
  'VIBRATE', 'USE_BIOMETRIC', 'USE_FINGERPRINT',
]) {
  test(`Android generation blocks ${permission} from dependency manifests`, () => {
    const entries = permissions.filter((entry) => entry.$['android:name'] === `android.permission.${permission}`);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].$['tools:node'], 'remove');
  });
}

test('Android generation removes the unused recording service', () => {
  const services = manifest.application[0].service ?? [];
  const recording = services.find((entry) => entry.$['android:name'] === 'expo.modules.audio.service.AudioRecordingService');
  assert.equal(recording?.$['tools:node'], 'remove');
  assert.ok(!services.some((entry) =>
    entry.$['android:name'] === 'expo.modules.audio.service.AudioControlsService' && entry.$['tools:node'] === 'remove'));
});

test('Android generation preserves location and playback permissions', () => {
  for (const permission of [
    'ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'ACCESS_BACKGROUND_LOCATION',
    'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION', 'MODIFY_AUDIO_SETTINGS',
  ]) {
    assert.ok(permissions.some((entry) =>
      entry.$['android:name'] === `android.permission.${permission}` && entry.$['tools:node'] !== 'remove'), permission);
  }
  assert.ok(!permissions.some((entry) =>
    entry.$['android:name'] === 'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK' && entry.$['tools:node'] === 'remove'));
});

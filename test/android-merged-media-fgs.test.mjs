import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import xml2js from 'xml2js';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = process.env.KUDY_RELEASE_MANIFEST ?? path.join(root,
  'android/app/build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml');

test('#854 AC3: merged release manifest declares only the needed FGS types',
  { skip: !fs.existsSync(manifestPath) && !process.env.KUDY_RELEASE_MANIFEST
    ? 'build :app:processReleaseMainManifest to check the native merged manifest' : undefined }, async () => {
    const xml = await fs.promises.readFile(manifestPath, 'utf8');
    const parsed = await xml2js.parseStringPromise(xml);
    const manifest = parsed.manifest;
    const permissions = new Set((manifest['uses-permission'] ?? []).map((entry) => entry.$['android:name']));
    const services = manifest.application?.[0]?.service ?? [];
    const named = (name) => services.filter((entry) => entry.$['android:name'] === name);

    assert.equal(manifest.$.package, 'by.kudy.app');
    for (const name of ['FOREGROUND_SERVICE_LOCATION', 'FOREGROUND_SERVICE_MEDIA_PLAYBACK']) {
      assert.ok(permissions.has(`android.permission.${name}`), `${name} permission missing`);
    }
    assert.ok(!permissions.has('android.permission.FOREGROUND_SERVICE_MICROPHONE'), 'microphone FGS permission present');
    assert.ok(!permissions.has('android.permission.RECORD_AUDIO'), 'microphone recording permission present');
    assert.equal(named('expo.modules.audio.service.AudioRecordingService').length, 0);
    const audio = named('expo.modules.audio.service.AudioControlsService');
    assert.equal(audio.length, 1, 'one mediaPlayback service must be merged');
    assert.equal(audio[0].$['android:foregroundServiceType'], 'mediaPlayback');
    assert.equal(audio[0].$['android:exported'], 'false');
    assert.ok(services.some((entry) =>
      entry.$['android:foregroundServiceType']?.split('|').includes('location')), 'location FGS missing');
  });

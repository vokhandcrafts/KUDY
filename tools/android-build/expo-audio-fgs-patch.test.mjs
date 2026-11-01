import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { patchExpoAudioNative } from './expo-audio-fgs-patch.cjs';

const playerSource = `
  fun setActiveForLockScreen(active: Boolean, metadata: Metadata? = null, options: AudioLockScreenOptions? = null) {
    if (active) {
      this.metadata = metadata
      AudioControlsService.setActivePlayer(context, this, metadata, options)
    } else if (isActiveForLockScreen) {
      AudioControlsService.setActivePlayer(context, null)
    }
  }
  fun clearLockScreenControls() {
    if (isActiveForLockScreen) {
      AudioControlsService.setActivePlayer(context, null)
    }
  }
  override fun sharedObjectDidRelease() {
    super.sharedObjectDidRelease()
    appContext?.mainQueue?.launch {
      if (isActiveForLockScreen) {
        AudioControlsService.clearSession()
      }
      playerScope.cancel()
`;

const serviceSource = `
    // Ensure channel exists and update current notification
    postOrStartForegroundNotification(startInForeground = false)
    return super.onStartCommand(intent, flags, startId)
  }
  companion object {
    private var pendingPlayer: AudioPlayer? = null
    private var pendingMetadata: Metadata? = null
    private var pendingOptions: AudioLockScreenOptions? = null
    fun getInstance(): AudioControlsService? = instance
    fun setActivePlayer(
`;

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-audio-fgs-'));
  const android = path.join(root, 'node_modules/expo-audio/android/src/main/java/expo/modules/audio');
  fs.mkdirSync(path.join(android, 'service'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules/expo-audio/package.json'), '{"version":"1.1.1"}');
  const player = path.join(android, 'AudioPlayer.kt');
  const service = path.join(android, 'service/AudioControlsService.kt');
  fs.writeFileSync(player, playerSource);
  fs.writeFileSync(service, serviceSource);
  return { root, player, service };
}

test('#854: native patch cancels a pending Play before service onCreate', (t) => {
  const { root, player, service } = makeFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  patchExpoAudioNative(root);
  const p = fs.readFileSync(player, 'utf8');
  const s = fs.readFileSync(service, 'utf8');
  assert.match(p, /fun clearLockScreenControls\(\) \{\s*AudioControlsService\.clearPlayer\(this\)/);
  assert.match(p, /else \{\s*AudioControlsService\.clearPlayer\(this\)/);
  assert.match(p, /override fun sharedObjectDidRelease\([\s\S]*?AudioControlsService\.clearPlayer\(this@AudioPlayer\)/);
  assert.match(s, /if \(pendingPlayer === player\) \{\s*pendingPlayer = null/);
  assert.match(s, /if \(service\.currentPlayer === player\)/);
  assert.match(s, /if \(currentPlayer == null\) \{\s*stopSelf\(startId\)/);
  const first = [p, s];
  patchExpoAudioNative(root);
  assert.deepEqual([fs.readFileSync(player, 'utf8'), fs.readFileSync(service, 'utf8')], first,
    'repeated Expo prebuild must not duplicate the native patch');
});

test('#854: native patch rejects SDK drift atomically', (t) => {
  const { root, player, service } = makeFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(service, serviceSource.replace('postOrStartForegroundNotification(startInForeground = false)', 'changedSDK()'));
  assert.throws(() => patchExpoAudioNative(root), /AudioControlsService/);
  assert.equal(fs.readFileSync(player, 'utf8'), playerSource, 'do not leave the SDK half patched');
});

test('#854: Android prebuild registers the native patch', () => {
  const withPlayback = fs.readFileSync(new URL('./with-playback-only.cjs', import.meta.url), 'utf8');
  assert.match(withPlayback, /withDangerousMod/);
  assert.match(withPlayback, /patchExpoAudioNative\(config\.modRequest\.projectRoot\)/);
});

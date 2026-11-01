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
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Ensure channel exists and update current notification
    postOrStartForegroundNotification(startInForeground = false)
    return super.onStartCommand(intent, flags, startId)
  }
  override fun onCreate() {
    super.onCreate()
    instance = this
    createNotificationChannelIfNeeded()

    pendingPlayer?.let { player ->
      setActivePlayerInternal(player, pendingMetadata, pendingOptions)
      pendingPlayer = null
      pendingMetadata = null
    }
  }
  private fun setActivePlayerInternal(
    player: AudioPlayer?,
    metadata: Metadata? = null,
    options: AudioLockScreenOptions? = null
  ) {
    // Detach listener from previous player
  }
  override fun onDestroy() {
    super.onDestroy()
    instance = null
    mediaSession?.release()
    currentPlayer = null
  }
  companion object {
    private var pendingPlayer: AudioPlayer? = null
    private var pendingMetadata: Metadata? = null
    private var pendingOptions: AudioLockScreenOptions? = null
    fun getInstance(): AudioControlsService? = instance
    fun setActivePlayer(
      context: Context,
      player: AudioPlayer?,
      metadata: Metadata? = null,
      options: AudioLockScreenOptions? = null
    ) {
      val service = getInstance()
      if (service != null) {
        service.setActivePlayerInternal(player, metadata, options)
      } else {
        val intent = Intent(context, AudioControlsService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }

        pendingPlayer = player
        pendingMetadata = metadata
        pendingOptions = options
      }
    }
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
  assert.match(s, /if \(currentPlayer == null\) \{\s*scheduleIdleStop\(\)/);
  const first = [p, s];
  patchExpoAudioNative(root);
  assert.deepEqual([fs.readFileSync(player, 'utf8'), fs.readFileSync(service, 'utf8')], first,
    'repeated Expo prebuild must not duplicate the native patch');
});

test('#854: replacing A with B cancels A idle shutdown before it can destroy B', (t) => {
  const { root, service } = makeFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  patchExpoAudioNative(root);
  const source = fs.readFileSync(service, 'utf8');
  assert.match(source, /private fun scheduleIdleStop\(\) \{[\s\S]*?postDelayed\(idleStopRunnable, 1000L\)/);
  assert.match(source, /if \(currentPlayer == null && pendingPlayer == null\) \{\s*stopRequested = true\s*stopMayDestroy = true\s*stopSelf\(\)/);
  assert.match(source, /if \(player != null\) \{\s*cancelIdleStop\(\)/);
  assert.match(source, /service\.setActivePlayerInternal\(null\)\s*service\.scheduleIdleStop\(\)/);
  assert.doesNotMatch(source, /service\.setActivePlayerInternal\(null\)\s*service\.stopSelf\(\)/,
    'immediate stopSelf races against player B activation');
});

test('#854: activation after stopSelf restarts service, including the onDestroy boundary', (t) => {
  const { root, service } = makeFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  patchExpoAudioNative(root);
  const source = fs.readFileSync(service, 'utf8');
  assert.match(source, /stopRequested = true\s*stopMayDestroy = true\s*stopSelf\(\)/,
    'idle shutdown must mark the instance as stopping');
  assert.match(source, /service != null && !\(player != null && service\.stopRequested\)/,
    'a new player must not attach directly to a service already stopping');
  assert.match(source, /pendingPlayer = player[\s\S]*?startPlaybackService\(context\)/,
    'a new start must retain player B before requesting a service start');
  assert.match(source, /override fun onStartCommand\([\s\S]*?activatePendingPlayer\(\)/,
    'a restarted start command must claim B even if onCreate does not run');
  assert.match(source, /override fun onCreate\([\s\S]*?activatePendingPlayer\(\)/,
    'a new service must also claim the pending player');
  assert.match(source, /override fun onDestroy\([\s\S]*?if \(stopMayDestroy && currentPlayer != null && pendingPlayer == null\)/,
    'the dying service must recover B only if a new pending owner was not already queued');
  assert.match(source, /startPlaybackService\(applicationContext\)/,
    'onDestroy must request a fresh lifecycle when B survived an old stopSelf');
});

test('#854: a fresh start clears the routing flag but retains the in-flight destroy guard', (t) => {
  const { root, service } = makeFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  patchExpoAudioNative(root);
  const source = fs.readFileSync(service, 'utf8');
  assert.match(source, /stopRequested = true\s*stopMayDestroy = true\s*stopSelf\(\)/);
  assert.match(source, /activatePendingPlayer\(\)[\s\S]*?if \(currentPlayer != null\) \{\s*stopRequested = false/);
  assert.match(source, /if \(stopMayDestroy && currentPlayer != null && pendingPlayer == null\)/);
  assert.match(source, /service != null && !\(player != null && service\.stopRequested\)/);
});

test('#854: forced onDestroy detaches the only B listener before releasing its session', (t) => {
  const { root, service } = makeFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  patchExpoAudioNative(root);
  const source = fs.readFileSync(service, 'utf8');
  const fromDestroy = source.indexOf('  override fun onDestroy()');
  const toCompanion = source.indexOf('  companion object {', fromDestroy);
  assert.ok(fromDestroy >= 0 && toCompanion > fromDestroy, 'onDestroy lifecycle must be present');
  const body = source.slice(fromDestroy, toCompanion);
  assert.match(body, /playbackListener\?\.let \{ listener ->\s*currentPlayer\?\.ref\?\.removeListener\(listener\)\s*\}/);
  assert.match(body, /playbackListener = null/);
  assert.match(body, /currentPlayer\?\.isActiveForLockScreen = false/);
  assert.ok(body.indexOf('removeListener(listener)') < body.indexOf('mediaSession?.release()'),
    'stale callback must be detached before the old MediaSession is released');
  assert.ok(body.indexOf('playbackListener = null') < body.indexOf('mediaSession?.release()'),
    'old service must not retain B listener on restart');
  assert.match(body, /mediaSession = null\s*currentPlayer = null/);
  assert.match(body, /pendingPlayer = restartPlayer[\s\S]*?startPlaybackService\(applicationContext\)/);
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

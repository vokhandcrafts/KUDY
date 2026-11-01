// APR-08.c (#854): pin a fix for the Expo Audio 1.1.1 Android
// startForegroundService race (Play -> Stop before onCreate).
// Applied during Expo prebuild, before Gradle compiles node_modules.
const fs = require('node:fs');
const path = require('node:path');

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const occurrences = source.split(before).length - 1;
  if (occurrences !== 1) {
    throw new Error(`expo-audio Android patch: expected one ${label} anchor, found ${occurrences}; inspect SDK version`);
  }
  return source.replace(before, after);
}

function patchPlayer(source) {
  let next = replaceOnce(source,
    `    } else if (isActiveForLockScreen) {
      AudioControlsService.setActivePlayer(context, null)
    }`,
    `    } else {
      AudioControlsService.clearPlayer(this)
    }`,
    'AudioPlayer.setActiveForLockScreen');
  next = replaceOnce(next,
    `  fun clearLockScreenControls() {
    if (isActiveForLockScreen) {
      AudioControlsService.setActivePlayer(context, null)
    }
  }`,
    `  fun clearLockScreenControls() {
    AudioControlsService.clearPlayer(this)
  }`,
    'AudioPlayer.clearLockScreenControls');
  next = replaceOnce(next,
    `    appContext?.mainQueue?.launch {
      if (isActiveForLockScreen) {
        AudioControlsService.clearSession()
      }
      playerScope.cancel()`,
    `    appContext?.mainQueue?.launch {
      AudioControlsService.clearPlayer(this@AudioPlayer)
      playerScope.cancel()`,
    'AudioPlayer.sharedObjectDidRelease');
  return next;
}

function patchService(source) {
  let next = replaceOnce(source,
    `    // Ensure channel exists and update current notification
    postOrStartForegroundNotification(startInForeground = false)`,
    `    // A queued start can be cancelled before onCreate by an immediate Stop.
    // Stop the empty service instead of leaving an FGS start pending.
    if (currentPlayer == null) {
      stopSelf(startId)
      return START_NOT_STICKY
    }
    // Ensure channel exists and update current notification
    postOrStartForegroundNotification(startInForeground = false)`,
    'AudioControlsService.onStartCommand');
  next = replaceOnce(next,
    `    fun getInstance(): AudioControlsService? = instance`,
    `    fun getInstance(): AudioControlsService? = instance

    // Clear only this player's pending/active session. Checking identity
    // prevents a late release of A from cancelling replacement player B.
    fun clearPlayer(player: AudioPlayer) {
      if (pendingPlayer === player) {
        pendingPlayer = null
        pendingMetadata = null
        pendingOptions = null
      }
      getInstance()?.let { service ->
        if (service.currentPlayer === player) {
          service.setActivePlayerInternal(null)
          service.stopSelf()
        }
      }
    }`,
    'AudioControlsService.clearPlayer');
  return next;
}

function patchExpoAudioNative(projectRoot) {
  const packageRoot = path.join(projectRoot, 'node_modules', 'expo-audio');
  const version = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version;
  if (version !== '1.1.1') {
    throw new Error(`expo-audio Android patch expects 1.1.1; installed ${version}`);
  }
  const dir = path.join(packageRoot, 'android', 'src', 'main', 'java', 'expo', 'modules', 'audio');
  const playerFile = path.join(dir, 'AudioPlayer.kt');
  const serviceFile = path.join(dir, 'service', 'AudioControlsService.kt');
  const playerOriginal = fs.readFileSync(playerFile, 'utf8');
  const serviceOriginal = fs.readFileSync(serviceFile, 'utf8');
  // Validate both inputs before mutating either: avoid a half-patched SDK.
  const playerNext = patchPlayer(playerOriginal);
  const serviceNext = patchService(serviceOriginal);
  if (playerNext !== playerOriginal) fs.writeFileSync(playerFile, playerNext);
  if (serviceNext !== serviceOriginal) fs.writeFileSync(serviceFile, serviceNext);
}

module.exports = { patchExpoAudioNative };

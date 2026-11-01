const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const { patchExpoAudioNative } = require('./expo-audio-fgs-patch.cjs');

module.exports = (config) => {
  // Patch the pinned native SDK during prebuild; no separate Gradle or
  // postinstall workflow is needed on CI and EAS runners.
  config = withDangerousMod(config, ['android', async (config) => {
    patchExpoAudioNative(config.modRequest.projectRoot);
    return config;
  }]);
  return withAndroidManifest(config, (config) => {
    const manifest = AndroidConfig.Manifest.ensureToolsAvailable(config.modResults);
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    const name = 'expo.modules.audio.service.AudioRecordingService';
    application.service = (application.service ?? []).filter((service) => service.$['android:name'] !== name);
    application.service.push({ $: { 'android:name': name, 'tools:node': 'remove' } });
    return config;
  });
};

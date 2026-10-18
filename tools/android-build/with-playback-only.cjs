const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

module.exports = (config) => withAndroidManifest(config, (config) => {
  const manifest = AndroidConfig.Manifest.ensureToolsAvailable(config.modResults);
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  const name = 'expo.modules.audio.service.AudioRecordingService';
  application.service = (application.service ?? []).filter((service) => service.$['android:name'] !== name);
  application.service.push({ $: { 'android:name': name, 'tools:node': 'remove' } });
  return config;
});

const { expo } = require('./app.json');

// The sample APK is a separate install, so it cannot replace a real KUDY app.
const demo = process.env.EXPO_PUBLIC_DEMO_MODE === '1';
module.exports = {
  expo: demo ? {
    ...expo,
    name: 'KUDY Demo',
    slug: 'kudy-demo',
    icon: './assets/demo-icon.png',
    android: { ...expo.android, package: 'by.kudy.app.demo' },
    ios: { ...expo.ios, bundleIdentifier: 'by.kudy.app.demo' },
  } : expo,
};

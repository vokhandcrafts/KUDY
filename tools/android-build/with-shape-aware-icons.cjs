const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');

const DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];

// Expo otherwise gives both mipmap launchers the same adaptive foreground:
// the square launcher ends up showing a small circle with a cream halo.
// Apply shape-specific, pre-rendered resources after Expo icon generation.
function installLauncherIcons(projectRoot) {
  const source = path.join(projectRoot, 'assets/kudy-icon/native-android');
  const res = path.join(projectRoot, 'android/app/src/main/res');
  for (const density of DENSITIES) {
    const dest = path.join(res, `mipmap-${density}`);
    fs.mkdirSync(dest, { recursive: true });
    for (const name of ['ic_launcher', 'ic_launcher_round', 'ic_launcher_round_foreground']) {
      fs.copyFileSync(
        path.join(source, `${name}-${density}.webp`),
        path.join(dest, `${name}.webp`),
      );
    }
  }

  const roundXml = path.join(res, 'mipmap-anydpi-v26/ic_launcher_round.xml');
  const xml = fs.readFileSync(roundXml, 'utf8');
  const standard = '@mipmap/ic_launcher_foreground';
  if (!xml.includes(standard)) {
    throw new Error('Android round icon XML changed; cannot install shape-specific foreground');
  }
  fs.writeFileSync(roundXml, xml.replace(standard, '@mipmap/ic_launcher_round_foreground'));
}

module.exports = (config) =>
  config.android?.adaptiveIcon
    ? withDangerousMod(config, ['android', async (modConfig) => {
        installLauncherIcons(modConfig.modRequest.projectRoot);
        return modConfig;
      }])
    : config;

module.exports.installLauncherIcons = installLauncherIcons;

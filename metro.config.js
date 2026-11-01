const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withStorybook } = require("@storybook/react-native/metro/withStorybook");

const config = getDefaultConfig(__dirname);

// Expo Router's require.context scans every *.ts(x) file in app/ — including
// the jest suites colocated there — so without this exclusion Metro pulls
// test/render-helpers.tsx (node:crypto, node:fs, @jest/globals) into the
// device bundle and the build fails before the app can render.
const jestFiles = /\.(test|spec)\.[cm]?[jt]sx?$/;
// Agent-session state dirs churn while Metro runs (parallel sessions create
// and delete lock files); metro-file-map's fallback watcher dies with ENOENT
// when a watched file vanishes mid-walk. None of it is app code.
const sessionDirs = /[/\\]\.(mimosa|zcode|scratch)[/\\]/;
const exclusions = [jestFiles, sessionDirs];
config.resolver.blockList = Array.isArray(config.resolver.blockList)
  ? [...config.resolver.blockList, ...exclusions]
  : [config.resolver.blockList, ...exclusions].filter(Boolean);

// The app root value-imports controllers → services, whose Node-only modules
// (node:path in contentRepo/inventory.ts) load on device but never execute
// (the root passes no ports until the device adapters land). Metro cannot
// resolve `node:*` for React Native, so they are mapped to a throwing stub.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform, extra) => {
  if (moduleName.startsWith("node:")) {
    return { type: "sourceFile", filePath: path.join(__dirname, "metro-node-stub.js") };
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform, extra)
    : context.resolveRequest(context, moduleName, platform, extra);
};

// DQ-13 (issue #914): the on-device Storybook joins the bundle only when the
// build runs with EXPO_PUBLIC_STORYBOOK=1 (criterion 2) — withStorybook is
// the official @storybook/react-native wrapper: with enabled=false it
// resolves every @storybook/* request to an empty module, and because the
// route imports .rnstorybook/root.tsx (not an index.*) the entry itself
// falls to the wrapper's {type: "empty"} branch — the production bundle
// keeps zero files of the @storybook packages (tools/metro-config/
// storybook-gate.test.mjs pins the behaviour and the wiring). The flag is
// read once at config load; flipping it requires a Metro restart. Telemetry
// is shut off for the metro integration itself (criterion 3) — withStorybook
// reports a "dev" event at config load unless this is set; no websockets
// option and no MCP flag are passed, so the wrapper's channel server branch
// is never taken.
process.env.STORYBOOK_DISABLE_TELEMETRY = "1";
module.exports = withStorybook(config, {
  enabled: process.env.EXPO_PUBLIC_STORYBOOK === "1",
  configPath: path.resolve(__dirname, "./.rnstorybook"),
});

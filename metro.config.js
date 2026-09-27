const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

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

module.exports = config;

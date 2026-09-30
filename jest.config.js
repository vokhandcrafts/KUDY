// UX 05 (issue #351): the jest workers' timezone is pinned before they fork
// from this parent process. The My KUDY local-day test can only fail on a
// UTC revert from a non-UTC zone (GitHub CI runs UTC), so this pin gives
// the check its teeth (implementation-rules 1). No other suite in this
// config's scope reads the clock.
process.env.TZ = "America/Anchorage";

module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/app/**/*.test.tsx", "<rootDir>/components/**/*.test.tsx"],
  // G06.10.c (issue #403): jest reads the "react-native" export condition,
  // which hands lucide-react-native's deep icon imports their ESM .mjs build —
  // an extension babel-jest's transform pattern never matches. The CJS build
  // of the same glyph is a drop-in for the test run; Metro keeps the device
  // bundle on the ESM condition. The guard is canon-icon.test.tsx itself:
  // drop this mapping and the suite dies on the ESM parse error.
  // G06.10.f (issue #406): the reanimated base is jest-mocked through the
  // official mock plus a controllable useReducedMotion stub (the official
  // mock omits it) — the seam the motion tests flip between the two paths.
  // The bare specifier covers the component suites; the `mock` subpath
  // covers expo-router's testing-library, whose mock factory returns
  // require("react-native-reanimated/mock") and would otherwise hand the
  // app suites the stub-less official mock. The guard is
  // test/app-jest-wiring.test.mjs: dropping the mapping loads the real base
  // and its worklet runtime, which jest cannot run.
  moduleNameMapper: {
    "^react-native-reanimated$": "<rootDir>/test/reanimated-mock.js",
    "^react-native-reanimated/mock$": "<rootDir>/test/reanimated-mock-subpath.js",
    "^lucide-react-native/icons/(.*)$": "<rootDir>/node_modules/lucide-react-native/dist/cjs/icons/$1.js",
  },
};

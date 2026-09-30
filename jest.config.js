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
  moduleNameMapper: {
    "^lucide-react-native/icons/(.*)$": "<rootDir>/node_modules/lucide-react-native/dist/cjs/icons/$1.js",
  },
};

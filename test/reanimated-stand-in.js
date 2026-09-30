// G06.10.f (issue #406) — the extended reanimated mock, one copy: the
// official `react-native-reanimated/mock` (every animation lands on its
// target instantly, so render tests keep their final-state assertions) plus
// the one hook the official mock omits — useReducedMotion as a controllable
// jest stub, the seam the motion tests flip between the two paths (AC2).
// Loaded through its absolute path: the anchored jest.config mappings for
// the bare specifier and the `mock` subpath must not resolve back into
// this file, and expo-router's testing-library mock factory (which returns
// require("react-native-reanimated/mock")) must never be able to recurse
// through its own registry entry. The guard is test/app-jest-wiring.test.mjs.
const path = require("node:path");

const reanimatedMock = require(path.join(
  __dirname,
  "..",
  "node_modules",
  "react-native-reanimated",
  "mock.js",
));

module.exports = {
  ...reanimatedMock,
  useReducedMotion: jest.fn(() => false),
};

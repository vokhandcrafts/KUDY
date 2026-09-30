// G06.10.f (issue #406) — the `react-native-reanimated/mock` subpath jest
// target: delegates to the same extended stand-in as the bare specifier,
// through a separate file so expo-router's testing-library mock factory
// (jest.mock("react-native-reanimated", () => require("react-native-reanimated/mock")))
// cannot recurse into its own registry entry — the two specifiers must
// resolve to different files.
module.exports = require("./reanimated-stand-in.js");

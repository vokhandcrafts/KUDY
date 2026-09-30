// G06.10.f (issue #406) — the bare-specifier jest target: delegates to the
// one extended stand-in. The expo-router testing-library factory mocks the
// bare specifier under THIS file's resolved path, so this delegator is what
// the factory replaces in app suites — the factory then builds the same
// stand-in through the `mock` subpath target (test/reanimated-mock-subpath.js).
module.exports = require("./reanimated-stand-in.js");

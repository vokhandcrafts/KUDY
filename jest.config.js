// UX 05 (issue #351): the jest workers' timezone is pinned before they fork
// from this parent process. The My KUDY local-day test can only fail on a
// UTC revert from a non-UTC zone (GitHub CI runs UTC), so this pin gives
// the check its teeth (implementation-rules 1). No other suite in this
// config's scope reads the clock.
process.env.TZ = "America/Anchorage";

module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/app/**/*.test.tsx", "<rootDir>/components/**/*.test.tsx"],
};

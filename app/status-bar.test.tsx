// Issue #428 — the status-bar guard: the navigation root pins the status
// bar to dark content, so the clock and the icons stay readable on the
// light paper on every screen (one config at the root, no screen sets its
// own). The suite mounts the real root layout — not the test mirror — with
// a prop-capturing stand-in for expo-status-bar; removing the config from
// app/_layout.tsx, or reverting it to "auto"/"light", turns this red
// (implementation-rules 1).
import { expect, jest, test } from "@jest/globals";
import { renderRouter } from "expo-router/testing-library";

const mountedStatusBarProps: unknown[] = [];
jest.mock("expo-status-bar", () => ({
  StatusBar: (props: unknown) => {
    mountedStatusBarProps.push(props);
    return null;
  },
}));

import RootLayout from "./_layout";

test("the navigation root mounts the status bar as dark content (issue #428)", () => {
  renderRouter({ _layout: RootLayout, index: () => null }, { initialUrl: "/" });
  const dark = mountedStatusBarProps.some(
    (props) => (props as { style?: unknown }).style === "dark",
  );
  expect(dark).toBe(true);
});

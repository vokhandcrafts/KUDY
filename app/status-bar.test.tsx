// #428/#436: the root owns the only status bar. This render test keeps
// light-mode glyphs dark; the pure resolver test guards dark-mode glyphs.
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
import { resolveThemeScheme, statusBarStyle } from "../components/theme";

test("the navigation root mounts the status bar as dark content (issue #428)", () => {
  renderRouter({ _layout: RootLayout, index: () => null }, { initialUrl: "/" });
  const dark = mountedStatusBarProps.some(
    (props) => (props as { style?: unknown }).style === "dark",
  );
  expect(dark).toBe(true);
});

test("the native status bar changes to light glyphs in dark mode (#436)", () => {
  expect(statusBarStyle(resolveThemeScheme("dark"))).toBe("light");
  expect(statusBarStyle(resolveThemeScheme("light"))).toBe("dark");
  expect(statusBarStyle(resolveThemeScheme(null))).toBe("dark");
});

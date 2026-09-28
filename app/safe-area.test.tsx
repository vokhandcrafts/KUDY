// UX 02 (issue #348) — the safe-area frame guard: with the native header
// off, every screen's content starts below the status bar and the notch —
// the top inset is the screen's own padding (AC4). The hook is pinned to a
// known fake inset; each screen's root must add it on top of the base
// spacing (50 + 16 = 66). Dropping a screen's inset padding turns its row
// red. The Run panels' bottom inset is pinned by the same fake through
// app/run.test.tsx (the panels exist only on a live-session surface).
import { describe, expect, jest, test } from "@jest/globals";
import { renderRouter, screen } from "expo-router/testing-library";

jest.mock("react-native-safe-area-context", () => ({
  ...(jest.requireActual("react-native-safe-area-context") as Record<string, unknown>),
  useSafeAreaInsets: () => ({ top: 50, bottom: 34, left: 0, right: 0 }),
}));

import { flatStyle, frameRoutes } from "../test/render-helpers";

test.each([
  ["explore", "/explore", "screen-Explore"],
  ["guides", "/city/gdansk/guides", "screen-Guides"],
  ["preview", "/route/r1", "screen-Route preview"],
  ["place", "/place/p1", "screen-Place detail"],
  ["run", "/run/r1", "screen-Run"],
  ["map", "/map", "screen-Map"],
  ["my", "/my", "screen-My KUDY"],
])("the %s screen starts its content below the pinned top inset (AC4)", async (_name, url, screenId) => {
  renderRouter(frameRoutes(), { initialUrl: url });
  expect(flatStyle(await screen.findByTestId(screenId)).paddingTop).toBe(66);
});

// UX 02 (issue #348) — the safe-area frame guard: with the native header
// off, every screen's content starts below the status bar and the notch —
// the top inset is the screen's own padding (AC4). The hook is pinned to a
// known fake inset; each screen's root must add it on top of the base
// spacing (50 + 16 = 66). Dropping a screen's inset padding turns its row
// red. APR-05 pins the bottom frame at a narrow width; the Run panels'
// bottom inset is pinned through app/run.test.tsx (live session only).
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { renderRouter, screen } from "expo-router/testing-library";
import { Dimensions } from "react-native";

jest.mock("react-native-safe-area-context", () => ({
  ...(jest.requireActual("react-native-safe-area-context") as Record<string, unknown>),
  useSafeAreaInsets: () => ({ top: 50, bottom: 34, left: 0, right: 0 }),
}));

import { flatStyle, frameRoutes } from "../test/render-helpers";

afterEach(() => {
  jest.restoreAllMocks();
});

test.each([
  ["explore", "/explore", "screen-Explore"],
  ["guides", "/city/gdansk/guides", "screen-Guides"],
  ["preview", "/route/r1", "screen-Route preview"],
  ["place", "/place/p1", "screen-Place detail"],
  ["collection", "/collection/c1", "screen-Collection"],
  ["discovery", "/discovery", "screen-Discovery"],
  ["feedback", "/feedback", "screen-Feedback"],
  ["run", "/run/r1", "screen-Run"],
  ["map", "/map", "screen-Map"],
  ["my", "/my", "screen-KUDY"],
  ["not-found", "/definitely/missing", "screen-Not found"],
])("the %s screen starts its content below the pinned top inset (AC4)", async (_name, url, screenId) => {
  renderRouter(frameRoutes(), { initialUrl: url });
  expect(flatStyle(await screen.findByTestId(screenId)).paddingTop).toBe(66);
});

test.each([
  ["explore", "/explore", "screen-Explore", 34],
  ["guides", "/city/gdansk/guides", "screen-Guides", 34],
  ["preview", "/route/r1", "screen-Route preview", 50],
  ["map", "/map", "screen-Map", 50],
  ["my", "/my", "screen-KUDY", 50],
  ["place", "/place/p1", "screen-Place detail", 50],
  ["collection", "/collection/c1", "screen-Collection", 50],
  ["discovery", "/discovery", "screen-Discovery", 50],
  ["feedback", "/feedback", "screen-Feedback", 50],
])("the %s scroll frame clears the bottom system bar at 320dp", async (_name, url, screenId, bottom) => {
  jest.spyOn(Dimensions, "get").mockReturnValue({
    width: 320,
    height: 640,
    scale: 2,
    fontScale: 1,
  });
  renderRouter(frameRoutes(), { initialUrl: url });
  const frame = await screen.findByTestId(screenId);
  expect(flatStyle(frame).paddingBottom).toBe(bottom);
});

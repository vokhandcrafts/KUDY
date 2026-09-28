// UX 02 (issue #348) — the safe-area frame guard: with the native header
// off, every screen's content starts below the status bar and the notch —
// the top inset is the screen's own padding (AC4). The hook is pinned to a
// known fake inset; each screen's root must add it on top of the base
// spacing (50 + 16 = 66). Dropping a screen's inset padding turns its row
// red. The Run panel's bottom inset belongs to the live-session surfaces —
// covered by the same pin through the unavailable state's root.
import { describe, expect, jest, test } from "@jest/globals";
import { renderRouter, screen } from "expo-router/testing-library";

jest.mock("react-native-safe-area-context", () => ({
  ...(jest.requireActual("react-native-safe-area-context") as Record<string, unknown>),
  useSafeAreaInsets: () => ({ top: 50, bottom: 34, left: 0, right: 0 }),
}));

import { frameRoutes } from "../test/render-helpers";

// The screens merge the inset into a style array or an inline object —
// flatten either shape and read the top padding.
function paddingTopOf(root: ReturnType<typeof screen.getByTestId>): number {
  const style = Array.isArray(root.props.style) ? Object.assign({}, ...root.props.style) : root.props.style;
  return style.paddingTop;
}

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
  expect(paddingTopOf(await screen.findByTestId(screenId))).toBe(66);
});

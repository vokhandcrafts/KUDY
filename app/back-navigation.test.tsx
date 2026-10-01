// UX 02 (issue #348) — the navigation-frame guards: every non-start screen
// hosts exactly one back element (getByTestId throws on a second) and its
// label lives inside a <Text> — within().getByText() reaches only <Text>
// hosts, so a reverted bare string in Pressable (the #344 class) turns these
// red. «Побач» gains its back and it walks back to the city (AC2, NAV9);
// the start surface stays back-free. G06.10 (issue #432): the one back image
// is the Lucide arrow beside the word — no screen renders a text arrow
// glyph, and the back word lives in the one chrome dictionary (the unity
// guard turns a re-added per-screen copy red).
import { describe, expect, test } from "@jest/globals";
import { fireEvent, renderRouter, screen, within } from "expo-router/testing-library";

import { placeDetailStrings } from "../controllers/place/placeDetailController";
import { runMapStrings } from "../controllers/run/runMap";
import { frameRoutes } from "../test/render-helpers";
import { uiStrings } from "../components/ui-strings";

// Every suite here runs the honest no-ports build (frameRoutes): the
// surfaces render their unavailable states — the frame (the one back
// element) is theirs regardless of the catalog facts.

test("«Побач» has its one back and it returns to the city (AC2)", async () => {
  renderRouter(frameRoutes(), { initialUrl: "/explore" });
  fireEvent.press(await screen.findByTestId("link-nearby"));
  expect(await screen.findByTestId("screen-Map")).toBeTruthy();
  expect(screen.queryAllByText(/←/)).toHaveLength(0);
  fireEvent.press(screen.getByTestId("btn-map-back"));
  expect(await screen.findByTestId("screen-Explore")).toBeTruthy();
});

test.each([
  ["guides", "/city/gdansk/guides", "btn-guides-back", "Горад", "screen-Guides"],
  ["preview", "/route/r1", "btn-preview-back", "Назад", "screen-Route preview"],
  ["place", "/place/p1", "btn-place-back", "Назад", "screen-Place detail"],
  ["run", "/run/r1", "btn-run-back", "Назад", "screen-Run"],
  ["my", "/my", "btn-my-back", "Назад", "screen-KUDY"],
  ["not-found", "/definitely/missing", "btn-not-found-back", "Назад", "screen-Not found"],
])("the %s screen hosts exactly one back and its label lives in a <Text>", async (_name, url, backId, label, screenId) => {
  renderRouter(frameRoutes(), { initialUrl: url });
  expect(await screen.findByTestId(screenId)).toBeTruthy();
  const back = screen.getByTestId(backId);
  expect(within(back).getByText(label)).toBeTruthy();
  expect(back.props.accessibilityRole).toBe("button");
  expect(back.props.accessibilityLabel).toBe(label);
});

test("the start surface stays back-free (AC2)", async () => {
  renderRouter(frameRoutes(), { initialUrl: "/explore" });
  expect(await screen.findByTestId("screen-Explore")).toBeTruthy();
  expect(screen.queryAllByText(/←/)).toHaveLength(0);
});

test("the back word lives in the one chrome dictionary, arrow-free (issue #432)", () => {
  // The chrome catalog is the single source of the back caption: the value
  // carries no text arrow (the arrow is the Lucide glyph BackButton
  // renders), and neither surface dictionary holds its own copy — a
  // re-added copy or arrow turns this red.
  for (const locale of ["be", "en"] as const) {
    for (const key of ["back", "backToCity"] as const) {
      const label = `${locale}.${key}`;
      expect(`${label}:${uiStrings(locale)[key].includes("←")}`).toBe(`${label}:false`);
    }
  }
  expect("back" in placeDetailStrings("be")).toBe(false);
  expect("back" in runMapStrings("be")).toBe(false);
  expect("back" in placeDetailStrings("en")).toBe(false);
  expect("back" in runMapStrings("en")).toBe(false);
});

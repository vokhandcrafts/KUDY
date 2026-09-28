// UX 02 (issue #348) — the navigation-frame guards: every non-start screen
// hosts exactly one back element (getByTestId throws on a second) and its
// label lives inside a <Text> — within().getByText() reaches only <Text>
// hosts, so a reverted bare string in Pressable (the #344 class) turns these
// red. «Побач» gains its back and it walks back to the city (AC2, NAV9);
// the start surface stays back-free.
import { describe, expect, test } from "@jest/globals";
import { fireEvent, renderRouter, screen, within } from "expo-router/testing-library";

import { frameRoutes } from "../test/render-helpers";

// Every suite here runs the honest no-ports build (frameRoutes): the
// surfaces render their unavailable states — the frame (the one back
// element) is theirs regardless of the catalog facts.

test("«Побач» has its one back and it returns to the city (AC2)", async () => {
  renderRouter(frameRoutes(), { initialUrl: "/explore" });
  fireEvent.press(await screen.findByTestId("link-nearby"));
  expect(await screen.findByTestId("screen-Map")).toBeTruthy();
  expect(screen.queryAllByText(/← /)).toHaveLength(1);
  fireEvent.press(screen.getByTestId("btn-map-back"));
  expect(await screen.findByTestId("screen-Explore")).toBeTruthy();
});

test.each([
  ["guides", "/city/gdansk/guides", "btn-guides-back", "← Горад", "screen-Guides"],
  ["preview", "/route/r1", "btn-preview-back", "← Назад", "screen-Route preview"],
  ["place", "/place/p1", "btn-place-back", "Назад", "screen-Place detail"],
  ["run", "/run/r1", "btn-run-back", "← Назад", "screen-Run"],
  ["my", "/my", "btn-my-back", "← Назад", "screen-My KUDY"],
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
  expect(screen.queryAllByText(/← /)).toHaveLength(0);
});

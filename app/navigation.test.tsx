import { describe, expect, test } from "@jest/globals";
import { fireEvent, renderRouter, screen, within } from "expo-router/testing-library";

import Explore from "./(tabs)/explore";
import My from "./(tabs)/my";
import Guides from "./city/[id]/guides";
import RoutePreview from "./route/[id]";
import Run from "./run/[id]";
import Map from "./map";
import NotFound from "./+not-found";

// The real production route components, mounted in the real route tree shape
// (19 §2.5); keys are module paths relative to app/ without the extension —
// expo-router's in-memory test context resolves modules by that key. Static
// imports are load-bearing: deleting a route file breaks these tests at the
// file level (task Proof).
const routes = {
  "(tabs)/explore": Explore,
  "(tabs)/my": My,
  "city/[id]/guides": Guides,
  "route/[id]": RoutePreview,
  "run/[id]": Run,
  map: Map,
  "+not-found": NotFound,
};

describe("route placeholders (19 §2.5)", () => {
  test.each([
    ["/explore", "screen-Explore", null],
    ["/my", "screen-My KUDY", null],
    ["/city/gdansk/guides", "screen-Guides", "id: gdansk"],
    ["/route/r1", "screen-Route preview", "id: r1"],
    ["/run/r1", "screen-Run", "id: r1"],
    ["/map", "screen-Map", null],
  ])("%s renders its placeholder", async (initialUrl, testID, param) => {
    renderRouter(routes, { initialUrl });
    const placeholder = await screen.findByTestId(testID);
    expect(placeholder).toBeTruthy();
    if (param) expect(within(placeholder).getByText(param)).toBeTruthy();
  });

  test("route params are named on the placeholder", async () => {
    renderRouter(routes, { initialUrl: "/city/gdansk/guides" });
    expect(await screen.findByText("id: gdansk")).toBeTruthy();
  });

  test("unknown path renders +not-found, not a crash", async () => {
    renderRouter(routes, { initialUrl: "/definitely/missing" });
    expect(await screen.findByTestId("screen-Not found")).toBeTruthy();
  });
});

describe("navigation walk (11 §16.1–16.2)", () => {
  test("City → Guides → preview → Run, Back returns to preview without ending anything", async () => {
    renderRouter(routes, { initialUrl: "/explore" });

    fireEvent.press(await screen.findByTestId("link-guides"));
    fireEvent.press(await screen.findByTestId("link-preview"));
    fireEvent.press(await screen.findByTestId("link-run"));
    expect(await screen.findByText("No session yet — there is nothing to end.")).toBeTruthy();

    fireEvent.press(await screen.findByTestId("btn-back"));
    expect(await screen.queryByText("No session yet — there is nothing to end.")).toBeNull();
    expect(await screen.findByTestId("link-run")).toBeTruthy();
  });
});

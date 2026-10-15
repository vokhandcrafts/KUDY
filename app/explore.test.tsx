// G06.10.e (issue #405) — the Explore surface carries the paper grain: the
// shared wrapper layers the grain over the unchanged paper token and the
// «Побач» entry still renders above it. Removing the wrapper from the
// screen (or the layer from the wrapper) turns this red
// (implementation-rules 1).
import { describe, expect, test } from "@jest/globals";
import { renderRouter, screen } from "expo-router/testing-library";

import Explore from "./(tabs)/explore";
import { createServices } from "../controllers/createServices";
import { tokens } from "../components/design-tokens";
import { flatStyle, layoutWith } from "../test/render-helpers";

describe("Explore paper grain (G06.10.e)", () => {
  test("the calm surface renders the grain layer over the unchanged paper", async () => {
    renderRouter(
      { _layout: layoutWith(createServices({})), "(tabs)/explore": Explore },
      { initialUrl: "/explore" },
    );
    expect(await screen.findByTestId("screen-Explore")).toBeTruthy();
    // The grain is in the render tree but never in the a11y tree — the
    // default query (which walks the accessibility tree) misses it.
    expect(screen.queryByTestId("paper-grain")).toBeNull();
    expect(screen.getByTestId("paper-grain", { includeHiddenElements: true })).toBeTruthy();
    expect(flatStyle(screen.getByTestId("screen-Explore")).backgroundColor).toBe(tokens.colorPaper);
    expect(screen.getByText("KUDY")).toBeTruthy();
    // The content above the grain: the nearby link is reachable.
    expect(screen.getByTestId("link-nearby")).toBeTruthy();
    expect(flatStyle(screen.getByTestId("link-nearby")).backgroundColor).toBe(tokens.colorCard);
  });

  test("demo build labels sample content and keeps the city routes", async () => {
    const previous = process.env.EXPO_PUBLIC_DEMO_MODE;
    process.env.EXPO_PUBLIC_DEMO_MODE = "1";
    try {
      renderRouter(
        { _layout: layoutWith(createServices({})), "(tabs)/explore": Explore },
        { initialUrl: "/explore" },
      );
      expect(await screen.findByTestId("demo-notice")).toBeTruthy();
      expect(screen.getByText("Дэманстрацыйная версія")).toBeTruthy();
      expect(screen.getByTestId("link-nearby")).toBeTruthy();
    } finally {
      if (previous === undefined) delete process.env.EXPO_PUBLIC_DEMO_MODE;
      else process.env.EXPO_PUBLIC_DEMO_MODE = previous;
    }
  });
});

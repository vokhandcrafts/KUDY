// UX 01 (issue #347) — the My KUDY surface render suite: a finished-run
// history of ten sessions renders inside the surface's ScrollView — the
// list is reachable by scroll, never cut by the fold. The rows come from a
// fake session-history port: the screen renders what the durable zone keeps
// and invents nothing (the G06.04 controller suite covers the states; this
// suite covers only the scroll surface, implementation-rules 1 — removing
// the ScrollView drops the testID and fails).
import { describe, expect, test } from "@jest/globals";
import { renderRouter, screen } from "expo-router/testing-library";

import My from "./(tabs)/my";
import { createServices } from "../controllers/createServices";
import { CATALOG_FIXTURES, layoutWith, serve, sha256 } from "../test/render-helpers";
import type { SessionRow } from "../services/db/types";

const finishedRow = (n: number): SessionRow => ({
  sessionId: `walk-render-${n}`,
  routeId: "route-map",
  version: "1",
  locale: "be",
  tier: ["base"],
  state: "finished",
  startedAt: n * 1_000,
  finishedAt: n * 1_000 + 500,
  autoFired: [],
  heard: ["story-1"],
  lastStopId: null,
  playSeq: 0,
});

describe("My KUDY surface (UX 01)", () => {
  test("the finished history scrolls: ten sessions render inside the ScrollView", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => finishedRow(i + 1));
    const services = createServices({ sessionHistory: { list: async () => rows } });
    renderRouter({ _layout: layoutWith(services), "(tabs)/my": My }, { initialUrl: "/my" });
    expect(await screen.findByTestId("scroll-my")).toBeTruthy();
    for (const row of rows) {
      expect(screen.getByTestId(`my-session-${row.sessionId}`)).toBeTruthy();
    }
  });
});

// UX 05 (issue #351): the rows show the catalog's guide title when the
// catalog names the route; a route it does not name keeps the raw id — the
// durable zone's own fact. Removing the lookup (or the fallback) fails one
// of the two assertions.
describe("My KUDY guide titles (UX 05)", () => {
  test("the ready catalog names the route; an unknown route falls back to its id", async () => {
    serve(CATALOG_FIXTURES);
    const rows = [
      { ...finishedRow(1), routeId: "guide-route-a1" },
      { ...finishedRow(2), routeId: "route-offline" },
    ];
    const services = createServices({
      catalogOrigin: "https://catalog.test",
      catalogSha256: sha256,
      sessionHistory: { list: async () => rows },
    });
    renderRouter({ _layout: layoutWith(services), "(tabs)/my": My }, { initialUrl: "/my" });
    expect(await screen.findByText("Гісторыі сукнараў: ад мытні да порта")).toBeTruthy();
    expect(screen.getByText("route-offline")).toBeTruthy();
  });
});

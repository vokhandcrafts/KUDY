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
import { layoutWith } from "../test/render-helpers";
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

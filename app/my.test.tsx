// UX 01 (issue #347) — the KUDY surface render suite (the display name since
// issue #426): a finished-run
// history of ten sessions renders inside the surface's ScrollView — the
// list is reachable by scroll, never cut by the fold. The rows come from a
// fake session-history port: the screen renders what the durable zone keeps
// and invents nothing (the G06.04 controller suite covers the states; this
// suite covers only the scroll surface, implementation-rules 1 — removing
// the ScrollView drops the testID and fails).
import { describe, expect, test } from "@jest/globals";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";

import My from "./(tabs)/my";
import { createServices } from "../controllers/createServices";
import { tokens } from "../components/design-tokens";
import { CATALOG_FIXTURES, flatStyle, layoutWith, serve, sha256 } from "../test/render-helpers";
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

describe("KUDY surface (UX 01)", () => {
  test("the finished history scrolls: ten sessions render inside the ScrollView", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => finishedRow(i + 1));
    const services = createServices({ sessionHistory: { list: async () => rows } });
    renderRouter({ _layout: layoutWith(services), "(tabs)/my": My }, { initialUrl: "/my" });
    expect(await screen.findByTestId("scroll-my")).toBeTruthy();
    for (const row of rows) {
      expect(screen.getByTestId(`my-session-${row.sessionId}`)).toBeTruthy();
    }
  });

  // Issue #426: the display name is «KUDY» (the owner's 2026-10-01 decision),
  // not «My KUDY» — reverting the string turns this red.
  test("the surface's title renders «KUDY» in the display locale", async () => {
    renderRouter({ _layout: layoutWith(createServices({})), "(tabs)/my": My }, { initialUrl: "/my" });
    expect(await screen.findByTestId("screen-KUDY")).toBeTruthy();
    expect(screen.getByText("KUDY")).toBeTruthy();
  });
});

// UX 05 (issue #351): the rows show the catalog's guide title when the
// catalog names the route; a route it does not name keeps the raw id — the
// durable zone's own fact. Removing the lookup (or the fallback) fails one
// of the two assertions.
describe("KUDY guide titles (UX 05)", () => {
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

// UX 07 (issue #353): the loading state shows the shared spinner next to the
// «Загрузка…» text — a never-resolving history read holds the surface in
// loading. Reverting the LoadingIndicator wiring in app/(tabs)/my.tsx turns
// this red (implementation-rules 1).
describe("KUDY loading indicator (UX 07)", () => {
  test("the loading state shows the ActivityIndicator next to the text", async () => {
    const services = createServices({ sessionHistory: { list: () => new Promise(() => {}) } });
    renderRouter({ _layout: layoutWith(services), "(tabs)/my": My }, { initialUrl: "/my" });
    expect(await screen.findByTestId("loading-indicator")).toBeTruthy();
    expect(screen.getByText("Загрузка…")).toBeTruthy();
  });
});

// G06.05 (issue #280, AC4): a failed history read is not a dead end — the
// named retry re-runs the controller's refresh, and a recovered read renders
// the rows (implementation-rules 1: removing the retry turns this red).
test("G06.05: the unavailable history offers the named retry and recovers", async () => {
  const rows = [finishedRow(1)];
  let calls = 0;
  const list = async (): Promise<SessionRow[]> => {
    calls += 1;
    // The boot read and the focus read both fail — the retry press is the
    // third read, and it is the one that recovers.
    if (calls < 3) throw new Error("db busy");
    return rows;
  };
  const services = createServices({ sessionHistory: { list } });
  renderRouter({ _layout: layoutWith(services), "(tabs)/my": My }, { initialUrl: "/my" });
  expect(await screen.findByTestId("my-unavailable")).toBeTruthy();
  fireEvent.press(screen.getByTestId("btn-my-retry"));
  await waitFor(() => expect(screen.getByTestId("my-session-walk-render-1")).toBeTruthy());
  expect(calls).toBe(3);
});

// G06.10.e (issue #405): the calm surface carries the paper grain over the
// unchanged paper — the wrapper's layer sits under the scrolling history.
// Removing the wrapper from the screen turns this red (implementation-rules 1).
describe("KUDY paper grain (G06.10.e)", () => {
  test("the surface renders the grain layer over the unchanged paper", async () => {
    renderRouter({ _layout: layoutWith(createServices({})), "(tabs)/my": My }, { initialUrl: "/my" });
    expect(await screen.findByTestId("screen-KUDY")).toBeTruthy();
    // The grain is in the render tree but never in the a11y tree — the
    // default query (which walks the accessibility tree) misses it.
    expect(screen.queryByTestId("paper-grain")).toBeNull();
    expect(screen.getByTestId("paper-grain", { includeHiddenElements: true })).toBeTruthy();
    expect(flatStyle(screen.getByTestId("screen-KUDY")).backgroundColor).toBe(tokens.colorPaper);
    // The content above the grain: the history list is mounted.
    expect(screen.getByTestId("scroll-my")).toBeTruthy();
  });
});

import { Stack } from "expo-router";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { fireEvent, renderRouter, screen, within } from "expo-router/testing-library";

import My from "./(tabs)/my";
import Run from "./run/[id]";
import RoutePreview from "./route/[id]";
import Map from "./map";
import NotFound from "./+not-found";
import Index from "./index";
import Explore from "./(tabs)/explore";
import Guides from "./city/[id]/guides";
import { ServicesContext } from "./_layout";
import { createServices } from "../controllers/createServices";
import { fixtureText, layoutWith, serve, sha256 } from "../test/render-helpers";

// The real production route components, mounted in the real route tree shape
// (19 §2.5); keys are module paths relative to app/ without the extension —
// expo-router's in-memory test context resolves modules by that key. Static
// imports are load-bearing: deleting a route file breaks these tests at the
// file level (task Proof).
const routes = {
  "(tabs)/my": My,
  "city/[id]/guides": Guides,
  "route/[id]": RoutePreview,
  "run/[id]": Run,
  map: Map,
  "+not-found": NotFound,
};

// The published fixtures (fixtures/discovery-contract): the catalog pointer
// declares the index's size and sha256, so the served texts pass the real
// integrity pin of the catalog service (rule 15: the render tests run the
// production path, the same service the device build runs).
const CATALOG_TEXT = fixtureText("catalog-with-discovery.json");
const INDEX_TEXT = fixtureText("index-valid.json");
const ROUTE_A1_TEXT = fixtureText("route-guide-route-a1.json");
const ROUTE_B1_TEXT = fixtureText("route-guide-route-b1.json");
const POINTER_PATH = "discovery/city-a/r-2026-09-14-1/index.json";

const withCatalogRoutes = (layout: ReturnType<typeof layoutWith>) => ({
  "_layout": layout,
  "(tabs)/explore": Explore,
  "city/[id]/guides": Guides,
  "route/[id]": RoutePreview,
  "run/[id]": Run,
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("route placeholders (19 §2.5)", () => {
  // G06.04: My KUDY is a real surface now. Without the history member (the
  // device db adapter is still to land) the root constructs no member and
  // the screen shows its honest unavailable state — no fake history.
  test("My KUDY without the history member renders its honest unavailable state", async () => {
    renderRouter({ "_layout": layoutWith(createServices({})), "(tabs)/my": My }, { initialUrl: "/my" });
    const myScreen = await screen.findByTestId("screen-My KUDY");
    expect(myScreen).toBeTruthy();
    expect(within(myScreen).getByText("Гісторыя недаступная")).toBeTruthy();
  });

  // G06.04 criterion 3: the session history — the live walk beside the
  // finished previous runs, the rows exactly what the durable zone keeps.
  // UX 05 (issue #351): the row's dates are the user's local calendar day.
  // The jest workers' zone is pinned to America/Anchorage (jest.config.js),
  // where 1970-01-01T00:00:05Z is already 1969-12-31 — a revert to the UTC
  // day fails this (implementation-rules 1).
  test("My KUDY shows the live walk and the previous runs (11 §16.2, 03)", async () => {
    const sessionHistory = {
      list: async () => [
        {
          sessionId: "walk-old",
          routeId: "route-map",
          version: "1",
          locale: "be",
          tier: ["base"],
          state: "finished" as const,
          startedAt: 1_000,
          finishedAt: 2_000,
          autoFired: [],
          heard: ["story-1"],
          lastStopId: null,
          playSeq: 1,
        },
        {
          sessionId: "walk-live",
          routeId: "route-other",
          version: "1",
          locale: "be",
          tier: ["base"],
          state: "paused" as const,
          startedAt: 5_000,
          finishedAt: null,
          autoFired: ["stop-1"],
          heard: ["story-1", "story-2"],
          lastStopId: null,
          playSeq: 2,
        },
      ],
    };
    renderRouter(
      { "_layout": layoutWith(createServices({ sessionHistory })), "(tabs)/my": My },
      { initialUrl: "/my" },
    );
    expect(await screen.findByTestId("my-live-section")).toBeTruthy();
    expect(screen.getByTestId("my-session-walk-live")).toBeTruthy();
    expect(screen.getByTestId("my-history-section")).toBeTruthy();
    expect(screen.getByTestId("my-session-walk-old")).toBeTruthy();
    // The row's own facts: the paused state word, the local started day and
    // the heard count. The catalog is absent here — the raw id stays the
    // row's title (UX 05, AC2's honest fallback).
    expect(screen.getByText(/route-other/)).toBeTruthy();
    expect(screen.getByText(/прыпыненая — з 1969-12-31 — праслышана: 2/)).toBeTruthy();
  });

  // G06.04 (11 §1, NAV7): the live walk puts «Прагулка» on the section-16
  // surfaces; pressing it navigates to the walk's Run surface — navigation
  // only, nothing else runs.
  test("the live walk shows «Прагулка» on Explore and it returns to the walk's Run", async () => {
    const services = createServices({
      runSession: { liveSession: () => ({ routeId: "route-map", title: "Каралеўская" }) },
    });
    renderRouter(withCatalogRoutes(layoutWith(services)), { initialUrl: "/explore" });
    fireEvent.press(await screen.findByTestId("btn-walk-mode"));
    // The run member is not constructed here (no run ports): the Run screen
    // renders its honest unavailable state — the navigation itself happened.
    expect(await screen.findByTestId("screen-Run")).toBeTruthy();
  });

  test("without a live walk no surface shows «Прагулка» (no fake destination)", async () => {
    renderRouter(withCatalogRoutes(layoutWith(createServices({}))), { initialUrl: "/explore" });
    expect(await screen.findByTestId("screen-Explore")).toBeTruthy();
    expect(screen.queryByTestId("btn-walk-mode")).toBeNull();
  });

  // G07.01 (issue #281): the Nearby surface is a real surface now. Without
  // the catalog ports the root constructs no nearby member and the screen
  // shows its honest unavailable state — no fake offers stand in (the
  // composition root's rule).
  test("the Nearby surface without the catalog ports renders its honest unavailable state", async () => {
    renderRouter({ "_layout": layoutWith(createServices({})), map: Map }, { initialUrl: "/map" });
    const nearby = await screen.findByTestId("screen-Map");
    expect(nearby).toBeTruthy();
    expect(within(nearby).getByText("Каталог недаступны")).toBeTruthy();
  });

  // G06.02: the run surface is a real surface now. Without the run ports the
  // root constructs no run member and the screen shows its honest unavailable
  // state — no fake session stands in (the composition root's rule).
  test("the run surface without the run ports renders its honest unavailable state", async () => {
    renderRouter({ "_layout": layoutWith(createServices({})), "run/[id]": Run }, { initialUrl: "/run/r1" });
    const runScreen = await screen.findByTestId("screen-Run");
    expect(runScreen).toBeTruthy();
    expect(within(runScreen).getByText("Сесія недаступная")).toBeTruthy();
  });

  test("unknown path renders +not-found, not a crash", async () => {
    renderRouter(routes, { initialUrl: "/definitely/missing" });
    expect(await screen.findByTestId("screen-Not found")).toBeTruthy();
  });

  // G06.01.b: the preview is a real surface now; without the catalog ports
  // it renders its honest unavailable state — no fake content.
  test("the preview without the catalog ports renders its honest unavailable state", async () => {
    renderRouter(
      { "_layout": layoutWith(createServices({})), "route/[id]": RoutePreview },
      { initialUrl: "/route/r1" },
    );
    expect(await screen.findByTestId("screen-Route preview")).toBeTruthy();
    expect(screen.getByText("Каталог недаступны")).toBeTruthy();
  });
});

describe("city surface on the published catalog (G06.01.a)", () => {
  // #339 criterion 1: the cold start opens the catalog, not +not-found — the
  // index route redirects to the canonical entry (screens-and-transitions,
  // Explore row: «Уваход: старт дадатка»), no screen of its own. Deleting
  // app/index.tsx breaks the static import at the file level; dropping the
  // redirect turns this red on "/".
  test("the cold start (/) opens the catalog through the index redirect", async () => {
    serve({ "catalog.json": CATALOG_TEXT, [POINTER_PATH]: INDEX_TEXT });
    renderRouter(
      {
        ...withCatalogRoutes(layoutWith(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 }))),
        index: Index,
      },
      { initialUrl: "/" },
    );
    expect(await screen.findByTestId("guide-card-guide-route-a1")).toBeTruthy();
  });

  test("the city renders the published guides: one card per guide, canon facts", async () => {
    serve({ "catalog.json": CATALOG_TEXT, [POINTER_PATH]: INDEX_TEXT });
    renderRouter(withCatalogRoutes(layoutWith(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 }))), {
      initialUrl: "/explore",
    });
    // The offer-backed guide card: editorial title, tariff badge, the
    // availability split (21 §3.2).
    expect(await screen.findByTestId("guide-card-guide-route-a1")).toBeTruthy();
    expect(screen.getByText("Гісторыі сукнараў: ад мытні да порта")).toBeTruthy();
    expect(screen.getByTestId("badge-access-paid")).toBeTruthy();
    expect(screen.getByText("Платна")).toBeTruthy();
    expect(screen.getByText("Тэкст: be, en, uk; аўдыё: be, en")).toBeTruthy();
    // The route without an offer stays honest: identifier as the title.
    expect(await screen.findByTestId("guide-card-guide-route-b1")).toBeTruthy();
    expect(screen.getByText("guide-route-b1")).toBeTruthy();
    expect(screen.getByTestId("badge-access-free")).toBeTruthy();
    expect(screen.getByText("Бясплатна")).toBeTruthy();
    // The rubric section is the chain's entry to the full list (11 §16.1).
    expect(screen.getByTestId("link-guides")).toBeTruthy();
  });

  test("the empty city renders the honest NAV3 message and no rubric (NAV2)", async () => {
    serve({ "catalog.json": JSON.stringify({ catalog_schema_version: 1, routes: [] }) });
    renderRouter(withCatalogRoutes(layoutWith(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 }))), {
      initialUrl: "/explore",
    });
    expect(await screen.findByTestId("city-message")).toBeTruthy();
    expect(screen.getByText("не апублікавана")).toBeTruthy();
    expect(screen.queryByTestId("link-guides")).toBeNull();
  });

  test("a failing catalog shows the named reason (11 §7), never invented cards", async () => {
    serve({});
    renderRouter(withCatalogRoutes(layoutWith(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 }))), {
      initialUrl: "/explore",
    });
    // The normal city page without discovery (21 §3.3): the honest message
    // primary, the technical reason muted below — and no rubric, no cards.
    expect(await screen.findByTestId("catalog-error")).toBeTruthy();
    expect(screen.getByText("Каталог часова недаступны")).toBeTruthy();
    expect(screen.getByText("catalog-loader-404")).toBeTruthy();
    expect(screen.queryByTestId("link-guides")).toBeNull();
  });

  test("a build without the catalog ports renders its honest unavailable state", async () => {
    renderRouter(withCatalogRoutes(layoutWith(createServices({}))), { initialUrl: "/explore" });
    expect(await screen.findByText("Каталог недаступны")).toBeTruthy();
  });
});

describe("rubric surface and the canonical chain (11 §16.1–16.2)", () => {
  test("the rubric lists the published guides and a card leads to the preview", async () => {
    serve({ "catalog.json": CATALOG_TEXT, [POINTER_PATH]: INDEX_TEXT });
    renderRouter(withCatalogRoutes(layoutWith(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 }))), {
      initialUrl: "/city/gdansk/guides",
    });
    expect(await screen.findByTestId("screen-Guides")).toBeTruthy();
    expect(await screen.findByTestId("guide-card-guide-route-a1")).toBeTruthy();
    expect(screen.getByTestId("guide-card-guide-route-b1")).toBeTruthy();

    // Card → preview: the same preview every path to the guide opens (D02).
    fireEvent.press(screen.getByTestId("guide-card-guide-route-a1"));
    expect(await screen.findByTestId("screen-Route preview")).toBeTruthy();
  });

  test("City → Guides → preview → Back walks the canonical chain back (NAV9)", async () => {
    serve({
      "catalog.json": CATALOG_TEXT,
      [POINTER_PATH]: INDEX_TEXT,
      "bundle/guide-route-a1/1/route.json": ROUTE_A1_TEXT,
    });
    renderRouter(withCatalogRoutes(layoutWith(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 }))), {
      initialUrl: "/explore",
    });

    fireEvent.press(await screen.findByTestId("link-guides"));
    fireEvent.press(await screen.findByTestId("guide-card-guide-route-a1"));
    expect(await screen.findByTestId("screen-Route preview")).toBeTruthy();

    // Back from the preview returns to the surface it was opened from —
    // the rubric — and the rubric's own back returns to the city.
    fireEvent.press(screen.getByTestId("btn-preview-back"));
    expect(await screen.findByTestId("screen-Guides")).toBeTruthy();
    fireEvent.press(screen.getByTestId("btn-guides-back"));
    expect(await screen.findByTestId("screen-Explore")).toBeTruthy();
  });

  test("Back from the rubric returns to the city (NAV9)", async () => {
    serve({ "catalog.json": CATALOG_TEXT, [POINTER_PATH]: INDEX_TEXT });
    renderRouter(withCatalogRoutes(layoutWith(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 }))), {
      initialUrl: "/explore",
    });
    fireEvent.press(await screen.findByTestId("link-guides"));
    expect(await screen.findByTestId("screen-Guides")).toBeTruthy();
    fireEvent.press(screen.getByTestId("btn-guides-back"));
    expect(await screen.findByTestId("screen-Explore")).toBeTruthy();
  });

  // G07.01 (issue #281): Journey 3's entry — the city surface's «Побач»
  // button opens the Nearby surface (NAV3: it works from the empty city too).
  test("the Explore surface's «Побач» button opens the Nearby surface", async () => {
    serve({ "catalog.json": CATALOG_TEXT, [POINTER_PATH]: INDEX_TEXT });
    renderRouter(
      { ...withCatalogRoutes(layoutWith(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 }))), map: Map },
      { initialUrl: "/explore" },
    );
    fireEvent.press(await screen.findByTestId("link-nearby"));
    expect(await screen.findByTestId("screen-Map")).toBeTruthy();
  });
});

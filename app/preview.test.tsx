// G06.01.b (issue #314) — the guide preview surface render tests over the
// real catalog service (the published fixtures, the same fetch-mocked
// production path the device build runs) and fake device ports for the
// disk truth, the download channel and the live session: the metadata
// facts of AC1, the paid gate of AC2/NAV6, the NAV5 locked-stop rows, the
// Download→Start flip of AC3 (the Proof at the render level), the §4.1
// dialog of NAV8 and the fail-closed state without ports.
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { fireEvent, renderRouter, screen } from "expo-router/testing-library";

import Explore from "./(tabs)/explore";
import Guides from "./city/[id]/guides";
import RoutePreview from "./route/[id]";
import { createServices } from "../controllers/createServices";
import type { BundlesStore, Readiness } from "../services/contentRepo/types";
import type { ActivationResult, LayerKey } from "../services/download/types";
import { fixtureText, layoutWith, serve, sha256 } from "../test/render-helpers";

const CATALOG_TEXT = fixtureText("catalog-with-discovery.json");
const INDEX_TEXT = fixtureText("index-valid.json");
const ROUTE_A1_TEXT = fixtureText("route-guide-route-a1.json");
const ROUTE_B1_TEXT = fixtureText("route-guide-route-b1.json");
const POINTER_PATH = "discovery/city-a/r-2026-09-14-1/index.json";

const PUBLISHED = {
  "catalog.json": CATALOG_TEXT,
  [POINTER_PATH]: INDEX_TEXT,
  "bundle/guide-route-a1/1/route.json": ROUTE_A1_TEXT,
  "bundle/guide-route-b1/3/route.json": ROUTE_B1_TEXT,
};

const withPreviewRoutes = (services: ReturnType<typeof createServices>) => ({
  "_layout": layoutWith(services),
  "(tabs)/explore": Explore,
  "city/[id]/guides": Guides,
  "route/[id]": RoutePreview,
});

// The read-only bundles store over an in-memory layer: the layer directory
// exists only after setDownloaded(true) — the disk truth the inventory port
// reads (09 §7 layout, one lock-declared stops.json of 5 bytes).
function memoryBundles(): { store: BundlesStore; setDownloaded: (value: boolean) => void } {
  const lock = JSON.stringify([{ path: "stops.json", bytes: 5, sha256: "f".repeat(64) }]);
  let downloaded = false;
  const store: BundlesStore = {
    listDir: async (rel) => {
      if (rel === "bundles") return ["guide-route-b1"];
      if (rel === "bundles/guide-route-b1") return downloaded ? ["3"] : [];
      if (rel === "bundles/guide-route-b1/3") return ["be"];
      return null;
    },
    readFile: async (rel) => ({
      kind: "present",
      bytes: new TextEncoder().encode(rel.endsWith("lock.json") ? lock : "stops"),
    }),
    statSize: async (rel) => (rel.endsWith("stops.json") ? 5 : null),
  };
  return { store, setDownloaded: (value) => (downloaded = value) };
}

const READY_EVALUATE = (routeId: string, version: string) => async (input: { routeId: string }) =>
  ({
    status: "ready",
    routeId,
    version,
    tier: "base",
    tierAvailable: ["base"],
  }) as Readiness;

function recordingDownload(): { downloadLayer: (key: LayerKey) => Promise<ActivationResult>; keys: string[] } {
  const keys: string[] = [];
  return {
    keys,
    downloadLayer: async (key) => {
      keys.push(key.routeId);
      return { status: "complete", key, verified: 1, bytes: 1, fetched: 1, diagnostics: [] };
    },
  };
}

function liveSessionOf(routeId: string | null) {
  const ref = { current: routeId };
  return {
    runSession: { liveSession: () => (ref.current ? { routeId: ref.current, title: "Каралеўская" } : null) },
    setLive: (value: string | null) => (ref.current = value),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("guide preview surface (G06.01.b)", () => {
  test("the paid preview shows the canon facts, free_stop_count and the disabled paid start (AC1, AC2, NAV6)", async () => {
    serve(PUBLISHED);
    renderRouter(
      withPreviewRoutes(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 })),
      { initialUrl: "/route/guide-route-a1?from=rubric" },
    );
    expect(await screen.findByText("Гісторыі сукнараў: ад мытні да порта")).toBeTruthy();
    expect(screen.getByTestId("badge-access-paid")).toBeTruthy();
    expect(screen.getByText("Тэкст: be, en, uk; аўдыё: be, en")).toBeTruthy();
    // The offer's estimated_duration range wins over the route document's
    // duration_min when both are published (AC1).
    expect(screen.getByText("Час: ад 45 да 75 хв")).toBeTruthy();
    expect(screen.getByText("Кропкі: 2")).toBeTruthy();
    expect(screen.getByText("Памер: 50 МБ")).toBeTruthy();
    expect(screen.getByText("Кропак бясплатна: 1")).toBeTruthy();
    // The paid start is disabled with its reason; pressing it starts no run
    // and triggers no purchase — nothing navigates, no dialog appears.
    expect(screen.getByText("патрэбна пакупка")).toBeTruthy();
    fireEvent.press(screen.getByTestId("btn-start"));
    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
    expect(screen.getByTestId("screen-Route preview")).toBeTruthy();
  });

  test("open and locked stops are distinguishable; the locked row shows name, place, announce and lock only (NAV5)", async () => {
    serve(PUBLISHED);
    renderRouter(
      withPreviewRoutes(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 })),
      { initialUrl: "/route/guide-route-b1?from=city" },
    );
    expect(await screen.findByTestId("stop-stop-b1-1")).toBeTruthy();
    expect(screen.getByText("Стары порт")).toBeTruthy();
    expect(screen.getByText("place-b1-1")).toBeTruthy();
    expect(screen.queryByTestId("stop-locked-stop-b1-1")).toBeNull();
    expect(screen.getByTestId("stop-locked-stop-b1-2")).toBeTruthy();
    expect(screen.getByText("Млынавая вуліца")).toBeTruthy();
    expect(screen.getByText("Кароткі анонс пашыранай гісторыі пра млын.")).toBeTruthy();
  });

  test("without the disk-truth port the button fails closed with its named reason (11 §7)", async () => {
    serve(PUBLISHED);
    renderRouter(
      withPreviewRoutes(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 })),
      { initialUrl: "/route/guide-route-b1" },
    );
    expect(await screen.findByText("стан пакета невядомы: сховішча недаступнае")).toBeTruthy();
    expect(screen.queryByTestId("btn-download")).toBeNull();
  });

  test("Download triggers the download flow and the same button becomes Start (AC3, the Proof)", async () => {
    serve(PUBLISHED);
    const bundles = memoryBundles();
    const download = recordingDownload();
    renderRouter(
      withPreviewRoutes(
        createServices({
          catalogOrigin: "https://catalog.test",
          catalogSha256: sha256,
          bundlesStore: bundles.store,
          evaluateLayer: READY_EVALUATE("guide-route-b1", "3"),
          downloadLayer: async (key) => {
            // The activation writes the layer onto the (fake) disk; the
            // flip must come from the refreshed inventory reading it.
            bundles.setDownloaded(true);
            return download.downloadLayer(key);
          },
        }),
      ),
      { initialUrl: "/route/guide-route-b1?from=rubric" },
    );
    expect(await screen.findByTestId("btn-download")).toBeTruthy();
    expect(screen.getByText("Загрузіць")).toBeTruthy();
    fireEvent.press(screen.getByTestId("btn-download"));
    expect(await screen.findByTestId("btn-start")).toBeTruthy();
    expect(screen.getByText("Пачаць")).toBeTruthy();
    expect(download.keys).toEqual(["guide-route-b1"]);
  });

  test("Start of another guide with a live session opens the §4.1 dialog; «Скасаваць» returns unchanged (NAV8)", async () => {
    serve(PUBLISHED);
    const bundles = memoryBundles();
    bundles.setDownloaded(true);
    const session = liveSessionOf("r-other");
    renderRouter(
      withPreviewRoutes(
        createServices({
          catalogOrigin: "https://catalog.test",
          catalogSha256: sha256,
          bundlesStore: bundles.store,
          evaluateLayer: READY_EVALUATE("guide-route-b1", "3"),
          runSession: session.runSession,
        }),
      ),
      { initialUrl: "/route/guide-route-b1" },
    );
    fireEvent.press(await screen.findByTestId("btn-start"));
    expect(await screen.findByTestId("confirm-dialog")).toBeTruthy();
    expect(screen.getByText("Завяршыць «Каралеўская» і пачаць «guide-route-b1»?")).toBeTruthy();
    fireEvent.press(screen.getByTestId("btn-confirm-cancel"));
    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
    expect(screen.getByTestId("screen-Route preview")).toBeTruthy();
  });

  test("Back from the preview returns to the city card it was opened from (NAV9)", async () => {
    serve(PUBLISHED);
    renderRouter(
      withPreviewRoutes(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 })),
      { initialUrl: "/explore" },
    );
    fireEvent.press(await screen.findByTestId("guide-card-guide-route-b1"));
    expect(await screen.findByTestId("screen-Route preview")).toBeTruthy();
    fireEvent.press(screen.getByTestId("btn-preview-back"));
    expect(await screen.findByTestId("screen-Explore")).toBeTruthy();
  });

  test("a route the catalog does not name renders the honest unavailable state", async () => {
    serve(PUBLISHED);
    renderRouter(
      withPreviewRoutes(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 })),
      { initialUrl: "/route/no-such-route" },
    );
    expect(await screen.findByTestId("preview-unavailable")).toBeTruthy();
    expect(screen.getByText("гід не апублікаваны")).toBeTruthy();
  });
});

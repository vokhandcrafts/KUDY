// G06.01.b (issue #314) — the guide preview surface render tests over the
// real catalog service (the published fixtures, the same fetch-mocked
// production path the device build runs) and fake device ports for the
// disk truth, the download channel and the live session: the metadata
// facts of AC1, the paid gate of AC2/NAV6, the NAV5 locked-stop rows, the
// Download→Start flip of AC3 (the Proof at the render level), the §4.1
// dialog of NAV8 and the fail-closed state without ports.
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { fireEvent, renderRouter, screen, within } from "expo-router/testing-library";
import { act } from "@testing-library/react-native";
import { Modal } from "react-native";
import { Svg } from "react-native-svg";

import Explore from "./(tabs)/explore";
import My from "./(tabs)/my";
import Guides from "./city/[id]/guides";
import RoutePreview from "./route/[id]";
import { tokens } from "../components/design-tokens";
import { createServices } from "../controllers/createServices";
import type { BundlesStore, Readiness } from "../services/contentRepo/types";
import type { ActivationResult, LayerKey } from "../services/download/types";
import { fixtureText, flatStyle, layoutWith, serve, sha256, CATALOG_FIXTURES, CATALOG_POINTER } from "../test/render-helpers";
import type { CommerceEventRecord, CommercePort } from "../controllers/commerce/commerceController";
import type { PurchaseOutcome } from "../services/entitlement/types";

const STOP_PLACE_CATALOG_TEXT = fixtureText("catalog-discovery-stop-places.json");
const STOP_PLACE_INDEX_TEXT = fixtureText("index-stop-places.json");

// The same publication with the index extended by route-b1's stop-place
// offers (UX 05, issue #351): the pointer's pin covers the new text.
const STOP_PLACE_PUBLISHED = {
  ...CATALOG_FIXTURES,
  "catalog.json": STOP_PLACE_CATALOG_TEXT,
  [CATALOG_POINTER]: STOP_PLACE_INDEX_TEXT,
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

// The insufficient-space failure arrange (G06.05 AC4): the download port
// answers with the honest storage deficit — the failure-exit test and the
// G06.10.d secondary-shelf test render this same state (jscpd: one copy).
function renderInsufficientSpacePreview() {
  return renderRouter(
    {
      "_layout": layoutWith(createServices({
        catalogOrigin: "https://catalog.test",
        catalogSha256: sha256,
        bundlesStore: memoryBundles().store,
        downloadLayer: async (key) => ({
          status: "insufficient-space" as const,
          key,
          needed: 30 * 1048576,
          free: 1048576,
        }),
      })),
      "(tabs)/my": My,
      "(tabs)/explore": Explore,
      "route/[id]": RoutePreview,
    },
    { initialUrl: "/route/guide-route-b1" },
  );
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
    serve(CATALOG_FIXTURES);
    renderRouter(
      withPreviewRoutes(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 })),
      { initialUrl: "/route/guide-route-a1?from=rubric" },
    );
    expect(await screen.findByText("Гісторыі сукнараў: ад мытні да порта")).toBeTruthy();
    expect(screen.getByTestId("badge-access-paid")).toBeTruthy();
    expect(screen.getByText("Платна")).toBeTruthy();
    expect(screen.getByText("Тэкст: be, en, uk; аўдыё: be, en")).toBeTruthy();
    // The offer's estimated_duration range wins over the route document's
    // duration_min when both are published (AC1).
    expect(screen.getByText("Час: ад 45 да 75 хв")).toBeTruthy();
    expect(screen.getByText("Кропкі: 2")).toBeTruthy();
    // G06.10.c (issue #403): the metadata row carries the icon layer — the
    // clock beside the duration fact, the map-pin beside the stops count.
    // Each row is one accessibility element announcing the fact once.
    const durationRow = screen.getByTestId("preview-duration");
    expect(durationRow.props.accessibilityLabel).toBe("Час: ад 45 да 75 хв");
    expect(within(durationRow).UNSAFE_getByType(Svg).props.className).toBe("lucide lucide-clock");
    const countsRow = screen.getByTestId("preview-counts");
    expect(countsRow.props.accessibilityLabel).toBe("Кропкі: 2");
    expect(within(countsRow).UNSAFE_getByType(Svg).props.className).toBe("lucide lucide-map-pin");
    expect(screen.getByText("Памер: 50 МБ")).toBeTruthy();
    expect(screen.getByText("Кропак бясплатна: 1")).toBeTruthy();
    // The paid start is disabled with its reason; pressing it starts no run
    // and triggers no purchase — nothing navigates, no dialog appears.
    expect(screen.getByText("Патрэбна пакупка.")).toBeTruthy();
    fireEvent.press(screen.getByTestId("btn-start"));
    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
    expect(screen.getByTestId("screen-Route preview")).toBeTruthy();
  });

  test("open and locked stops are distinguishable; the locked row shows name, place, announce and lock only (NAV5)", async () => {
    serve(CATALOG_FIXTURES);
    renderRouter(
      withPreviewRoutes(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 })),
      { initialUrl: "/route/guide-route-b1?from=city" },
    );
    expect(await screen.findByTestId("stop-stop-b1-1")).toBeTruthy();
    expect(screen.getByText("Стары порт")).toBeTruthy();
    // The index-valid fixture names no place for these stops — the place
    // line is hidden, the raw place id never renders (UX 05, issue #351).
    expect(screen.queryByText(/place-b1/)).toBeNull();
    expect(screen.queryByTestId("stop-locked-stop-b1-1")).toBeNull();
    expect(screen.getByTestId("stop-locked-stop-b1-2")).toBeTruthy();
    expect(screen.getByText("Млынавая вуліца")).toBeTruthy();
    expect(screen.getByText("Кароткі анонс пашыранай гісторыі пра млын.")).toBeTruthy();
    // G06.10 (issue #432): the locked badge renders the Lucide lock through
    // the icon layer — no emoji glyph anywhere in the rendered preview, the
    // badge's screen-reader word stays «Зачынена». The emoji query turns
    // red the moment the 🔒 markup returns.
    expect(screen.queryByText("🔒")).toBeNull();
    const lockedBadge = screen.getByTestId("stop-locked-stop-b1-2");
    expect(lockedBadge.props.accessibilityLabel).toBe("Зачынена");
    expect(within(lockedBadge).UNSAFE_getByType(Svg).props.className).toBe("lucide lucide-lock");
  });

  test("the stop rows show the place's human title from the catalog, never the raw place id (UX 05, AC1)", async () => {
    // The index-stop-places fixture publishes place offers for route-b1's
    // stops: the open row shows name + place title, the locked row shows the
    // full NAV5 set — name, place, announce and lock — with human words.
    serve(STOP_PLACE_PUBLISHED);
    renderRouter(
      withPreviewRoutes(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 })),
      { initialUrl: "/route/guide-route-b1?from=city" },
    );
    expect(await screen.findByTestId("stop-stop-b1-1")).toBeTruthy();
    expect(screen.getByText("Портаўская брама")).toBeTruthy();
    expect(screen.getByTestId("stop-locked-stop-b1-2")).toBeTruthy();
    expect(screen.getByText("Стары млын")).toBeTruthy();
    expect(screen.queryByText(/place-b1/)).toBeNull();
  });

  test("without the disk-truth port the button fails closed with its named reason (11 §7)", async () => {
    serve(CATALOG_FIXTURES);
    renderRouter(
      withPreviewRoutes(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 })),
      { initialUrl: "/route/guide-route-b1" },
    );
    expect(await screen.findByText("Сховішча недаступнае.")).toBeTruthy();
    expect(screen.queryByTestId("btn-download")).toBeNull();
  });

  test("Download triggers the download flow and the same button becomes Start (AC3, the Proof)", async () => {
    serve(CATALOG_FIXTURES);
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

  // The §4.1 world the NAV8 and UX 06 guards share: the ready Start and the
  // live session of another guide, so the dialog is open on entry.
  async function mountedConfirmDialog() {
    serve(CATALOG_FIXTURES);
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
    await screen.findByTestId("confirm-dialog");
  }

  test("Start of another guide with a live session opens the §4.1 dialog; «Скасаваць» returns unchanged (NAV8)", async () => {
    await mountedConfirmDialog();
    expect(screen.getByText("Завяршыць «Каралеўская» і пачаць «guide-route-b1»?")).toBeTruthy();
    fireEvent.press(screen.getByTestId("btn-confirm-cancel"));
    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
    expect(screen.getByTestId("screen-Route preview")).toBeTruthy();
  });

  // UX 06 (issue #352) AC1: the dialog is a real modal — a native Modal in
  // the tree (an in-tree overlay leaves none and the guard fails —
  // implementation-rules 1), and the system Back closes it in place: the
  // dialog goes, the preview stays, no walk starts and nothing navigates.
  test("UX 06 AC1: the §4.1 dialog is a native Modal; the system Back closes it in place", async () => {
    await mountedConfirmDialog();
    expect(screen.UNSAFE_queryAllByType(Modal)).toHaveLength(1);
    act(() => {
      screen.UNSAFE_queryByType(Modal)?.props.onRequestClose();
    });
    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
    expect(screen.getByTestId("screen-Route preview")).toBeTruthy();
  });

  // UX 06 (issue #352) AC2: «Скасаваць» is an active action with its own
  // outline style — no dimmed disabled opacity, the accent outline present.
  // Reverting the cancel to the disabled copy of the main button fails both
  // queries (implementation-rules 1).
  test("UX 06 AC2: «Скасаваць» carries its own outline style, not the disabled look", async () => {
    await mountedConfirmDialog();
    const resting = [screen.getByTestId("btn-confirm-cancel").props.style].flat(Infinity);
    expect(resting.some((s) => s && typeof s === "object" && s.opacity !== undefined)).toBe(false);
    expect(
      resting.some((s) => s && typeof s === "object" && s.borderColor === tokens.colorAccent && s.borderWidth === 1),
    ).toBe(true);
  });

  test("Back from the preview returns to the city card it was opened from (NAV9)", async () => {
    serve(CATALOG_FIXTURES);
    renderRouter(
      withPreviewRoutes(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 })),
      { initialUrl: "/explore" },
    );
    fireEvent.press(await screen.findByTestId("guide-card-guide-route-b1"));
    expect(await screen.findByTestId("screen-Route preview")).toBeTruthy();
    fireEvent.press(screen.getByTestId("btn-preview-back"));
    expect(await screen.findByTestId("screen-Explore")).toBeTruthy();
  });

  // The bare-string guard (issue #343): the JS render never throws on a
  // string child of <Pressable> — the error is the native renderer's — so
  // the label is asserted through the text query, which only reaches
  // strings inside a <Text> host. Removing the wrapper fails this.
  test("the back label sits in a Text host, not bare in the Pressable (issue #343)", async () => {
    serve(CATALOG_FIXTURES);
    renderRouter(
      withPreviewRoutes(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 })),
      { initialUrl: "/route/guide-route-a1?from=rubric" },
    );
    expect(await screen.findByTestId("btn-preview-back")).toBeTruthy();
    expect(within(screen.getByTestId("btn-preview-back")).getByText("Назад")).toBeTruthy();
  });

  test("a route the catalog does not name renders the honest unavailable state", async () => {
    serve(CATALOG_FIXTURES);
    renderRouter(
      withPreviewRoutes(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 })),
      { initialUrl: "/route/no-such-route" },
    );
    expect(await screen.findByTestId("preview-unavailable")).toBeTruthy();
    expect(screen.getByText("Гід не апублікаваны.")).toBeTruthy();
  });

  // UX 01 (issue #347): the surface scrolls — twelve stops and the main
  // action all render inside the preview's ScrollView. Removing the
  // ScrollView drops the scroll testID and fails this (implementation-rules 1).
  test("the preview scrolls: twelve stops and the main button render inside the ScrollView (UX 01)", async () => {
    serve({
      ...CATALOG_FIXTURES,
      "bundle/guide-route-b1/3/route.json": JSON.stringify({
        route_id: "guide-route-b1",
        version: "3",
        city_id: "gdansk",
        access: "free_base",
        distance_m: 4200,
        duration_min: 90,
        free_stop_count: 12,
        published: true,
        stops: Array.from({ length: 12 }, (_, position) => ({
          id: `stop-twelve-${position + 1}`,
          position,
          place_id: `place-twelve-${position + 1}`,
          access_tier: "base",
          story_base_id: `story-twelve-${position + 1}`,
          preview: {
            name: { be: `Кропка ${position + 1}`, en: `Stop ${position + 1}` },
            announce: { be: `Анонс кропкі ${position + 1}.`, en: `Stop ${position + 1} teaser.` },
          },
        })),
      }),
    });
    const bundles = memoryBundles();
    bundles.setDownloaded(true);
    renderRouter(
      withPreviewRoutes(
        createServices({
          catalogOrigin: "https://catalog.test",
          catalogSha256: sha256,
          bundlesStore: bundles.store,
          evaluateLayer: READY_EVALUATE("guide-route-b1", "3"),
        }),
      ),
      { initialUrl: "/route/guide-route-b1?from=city" },
    );
    expect(await screen.findByTestId("scroll-preview")).toBeTruthy();
    for (let position = 1; position <= 12; position += 1) {
      expect(screen.getByTestId(`stop-stop-twelve-${position}`)).toBeTruthy();
    }
    expect(screen.getByTestId("btn-start")).toBeTruthy();
  });
});

// UX 07 (issue #353): the loading state shows the shared spinner next to the
// «Загрузка…» text — a never-resolving catalog fetch holds the preview in
// loading. Reverting the LoadingIndicator wiring in app/route/[id].tsx turns
// this red (implementation-rules 1).
describe("guide preview loading indicator (UX 07)", () => {
  test("the loading state shows the ActivityIndicator next to the text", async () => {
    jest.spyOn(global, "fetch").mockImplementation(() => new Promise(() => {}));
    renderRouter(
      withPreviewRoutes(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 })),
      { initialUrl: "/route/guide-route-a1?from=rubric" },
    );
    expect(await screen.findByTestId("loading-indicator")).toBeTruthy();
    expect(screen.getByText("Загрузка…")).toBeTruthy();
  });
});

// G06.05 (issue #280) — the preview's a11y contract and the honest download
// failure: the main button is a named, stateful button for the screen
// reader; a failed activation is a named banner with a retry and, for
// insufficient space, the exit to the storage surface — never a dead end.
describe("G06.05 preview a11y and failure exits (issue #280)", () => {
  test("AC1: the main button is a button with its label and the disabled state", async () => {
    serve(CATALOG_FIXTURES);
    renderRouter(withPreviewRoutes(createServices({
      catalogOrigin: "https://catalog.test",
      catalogSha256: sha256,
      bundlesStore: memoryBundles().store,
      downloadLayer: recordingDownload().downloadLayer,
    })), { initialUrl: "/route/guide-route-b1" });
    const button = await screen.findByTestId("btn-download");
    expect(button.props.accessibilityRole).toBe("button");
    expect(button.props.accessibilityLabel).toBe("Загрузіць");
    expect(button.props.accessibilityState).toEqual({ disabled: false });
  });

  test("AC4: insufficient space is a named failure with the retry and the storage exit", async () => {
    serve(CATALOG_FIXTURES);
    renderInsufficientSpacePreview();
    fireEvent.press(await screen.findByTestId("btn-download"));
    await screen.findByTestId("download-error-banner");
    expect(screen.getByText("Збой загрузкі.")).toBeTruthy();
    expect(screen.getByText("не хапае месца: патрэбна яшчэ 30 МБ")).toBeTruthy();
    // The two manual exits of AC4: the named retry and the storage surface
    // (issue #426: the exit's words name the surface «KUDY» — reverting the
    // string fails this assertion, implementation-rules 1).
    expect(screen.getByTestId("btn-download-retry").props.accessibilityLabel).toBe("Паўтарыць");
    expect(screen.getByTestId("btn-download-storage").props.accessibilityLabel).toBe(
      "Вызваліць месца ў KUDY",
    );
    fireEvent.press(screen.getByTestId("btn-download-storage"));
    expect(await screen.findByTestId("screen-KUDY")).toBeTruthy();
  });

  test("AC4: the failed catalog load gets its named retry — one press re-runs the refresh", async () => {
    serve({});
    renderRouter(withPreviewRoutes(createServices({
      catalogOrigin: "https://catalog.test",
      catalogSha256: sha256,
    })), { initialUrl: "/explore" });
    await screen.findByTestId("catalog-error");
    // The load recovers without a remount: the second mock answers, the
    // retry re-runs the controller's refresh and the cards render.
    serve(CATALOG_FIXTURES);
    fireEvent.press(screen.getByTestId("catalog-retry"));
    expect(await screen.findByTestId("guide-card-guide-route-a1")).toBeTruthy();
  });

  test("AC1: the live walk's button is a named button (Прагулка)", async () => {
    renderRouter(withPreviewRoutes(createServices({
      runSession: { liveSession: () => ({ routeId: "route-map", title: "Каралеўская" }) },
    })), { initialUrl: "/explore" });
    const button = await screen.findByTestId("btn-walk-mode");
    expect(button.props.accessibilityRole).toBe("button");
    expect(button.props.accessibilityLabel).toBe("Прагулка");
  });
});

// G08.05 (issue #292) — the quiet commerce offer on the preview: the
// impression follows the render fact, not the mount (AC3); the decline is
// respected (AC4); repeated purchase errors keep both exits and the app
// keeps working (AC2, `11` C28); the §8 words follow the finished store
// leg; the absent port renders nothing (fail closed). The Run-surface
// absence of the card is proven in app/run.test.tsx (C26).
describe("G08.05 quiet commerce offer (issue #292)", () => {
  function commerceRig(outcome: PurchaseOutcome = { kind: "store-problem", code: "E_STORE" }) {
    const events: CommerceEventRecord[] = [];
    const purchases: string[] = [];
    // The port owns the state: only its own finished purchase answers paid —
    // a failed attempt leaves the chain at not-owned (G08.04's criterion 1).
    const succeeded = outcome.kind === "transaction-finished" || outcome.kind === "already-owned";
    let purchased = false;
    const commerce: CommercePort = {
      stateOf: () => (purchased ? "paid" : "not-owned"),
      purchase: async (productId) => {
        purchases.push(productId);
        if (succeeded) purchased = true;
        return outcome;
      },
    };
    const telemetry = { record: (event: CommerceEventRecord) => void events.push(event) };
    return { events, purchases, commerce, telemetry };
  }

  // The render fact (AC3): RN dispatches onLayout after the actual layout —
  // the test drives the same callback through the host props.
  const fireLayout = (testID: string) => {
    act(() => {
      screen.getByTestId(testID).props.onLayout?.({
        nativeEvent: { layout: { x: 0, y: 0, width: 100, height: 100 } },
      });
    });
  };

  test("the paid preview shows the quiet offer; the impression is the render fact (AC1, AC3)", async () => {
    serve(CATALOG_FIXTURES);
    const rig = commerceRig();
    renderRouter(
      withPreviewRoutes(
        createServices({
          catalogOrigin: "https://catalog.test",
          catalogSha256: sha256,
          commerce: rig.commerce,
          events: rig.telemetry,
        }),
      ),
      { initialUrl: "/route/guide-route-a1?from=rubric" },
    );
    expect(await screen.findByTestId("upgrade-offer")).toBeTruthy();
    expect(screen.getByText("Купіць")).toBeTruthy();
    expect(screen.getByText("Не цяпер")).toBeTruthy();
    // The mount alone records nothing — the layout fact has not arrived.
    expect(rig.events).toHaveLength(0);
    fireLayout("upgrade-offer");
    fireLayout("upgrade-offer");
    const shown = rig.events.filter((event) => event.type === "extension_offer_shown");
    expect(shown).toHaveLength(1);
    expect(shown[0].route_id).toBe("guide-route-a1");
    expect(typeof shown[0].offer_id).toBe("string");
    expect(shown[0].schema_version).toBe(1);
  });

  test("the decline is respected: the card is gone and buys nothing (AC4)", async () => {
    serve(CATALOG_FIXTURES);
    const rig = commerceRig();
    renderRouter(
      withPreviewRoutes(
        createServices({
          catalogOrigin: "https://catalog.test",
          catalogSha256: sha256,
          commerce: rig.commerce,
          events: rig.telemetry,
        }),
      ),
      { initialUrl: "/route/guide-route-a1" },
    );
    await screen.findByTestId("upgrade-offer");
    fireLayout("upgrade-offer");
    fireEvent.press(screen.getByTestId("btn-upgrade-dismiss"));
    expect(screen.queryByTestId("upgrade-offer")).toBeNull();
    // The re-sync the screen runs per surface change brings nothing back;
    // the store was never called.
    await act(async () => {});
    expect(screen.queryByTestId("upgrade-offer")).toBeNull();
    expect(rig.purchases).toHaveLength(0);
  });

  test("repeated errors keep both exits; Continue free returns to the working offer (AC2, C28)", async () => {
    serve(CATALOG_FIXTURES);
    const rig = commerceRig();
    renderRouter(
      withPreviewRoutes(
        createServices({
          catalogOrigin: "https://catalog.test",
          catalogSha256: sha256,
          commerce: rig.commerce,
          events: rig.telemetry,
        }),
      ),
      { initialUrl: "/route/guide-route-a1" },
    );
    fireEvent.press(await screen.findByTestId("btn-upgrade-buy"));
    expect(await screen.findByTestId("purchase-error-dialog")).toBeTruthy();
    expect(screen.getByText("Пакупка не скончылася")).toBeTruthy();
    // Both exits of C28 — and they return with the second error too.
    expect(screen.getByTestId("btn-purchase-retry")).toBeTruthy();
    expect(screen.getByTestId("btn-purchase-continue-free")).toBeTruthy();
    fireEvent.press(screen.getByTestId("btn-purchase-retry"));
    await screen.findByTestId("purchase-error-dialog");
    expect(screen.getByTestId("btn-purchase-retry")).toBeTruthy();
    expect(screen.getByTestId("btn-purchase-continue-free")).toBeTruthy();
    // Continue free: the dialog closes, the app stays on the preview with
    // the quiet offer, no point and no state lost.
    fireEvent.press(screen.getByTestId("btn-purchase-continue-free"));
    expect(screen.queryByTestId("purchase-error-dialog")).toBeNull();
    expect(screen.getByTestId("upgrade-offer")).toBeTruthy();
    expect(rig.purchases).toHaveLength(2);
    const failed = rig.events.filter((event) => event.type === "purchase_failed");
    expect(failed).toHaveLength(2);
    for (const event of failed) expect(event.reason).toBe("payment_failed");
  });

  test("the finished purchase shows the §8 words and the offer never returns", async () => {
    serve(CATALOG_FIXTURES);
    const rig = commerceRig({ kind: "transaction-finished", productId: "route_a1_prod" });
    renderRouter(
      withPreviewRoutes(
        createServices({
          catalogOrigin: "https://catalog.test",
          catalogSha256: sha256,
          commerce: rig.commerce,
          events: rig.telemetry,
        }),
      ),
      { initialUrl: "/route/guide-route-a1" },
    );
    fireEvent.press(await screen.findByTestId("btn-upgrade-buy"));
    expect(await screen.findByTestId("preview-purchased-pending")).toBeTruthy();
    expect(screen.getByText("Куплена · трэба загрузіць")).toBeTruthy();
    expect(screen.queryByTestId("upgrade-offer")).toBeNull();
    const started = rig.events.filter((event) => event.type === "purchase_started");
    expect(started).toHaveLength(1);
    // The join rule: the purchase came from the offer — the started event
    // carries its offer_id.
    const accepted = rig.events.find((event) => event.type === "extension_offer_accepted");
    expect(started[0].offer_id).toBe(accepted?.offer_id);
    expect(rig.events.some((event) => event.type === "purchase_succeeded")).toBe(true);
  });

  test("without the commerce port the paid preview renders no offer (fail closed)", async () => {
    serve(CATALOG_FIXTURES);
    renderRouter(
      withPreviewRoutes(
        createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 }),
      ),
      { initialUrl: "/route/guide-route-a1" },
    );
    expect(await screen.findByText("Патрэбна пакупка.")).toBeTruthy();
    expect(screen.queryByTestId("upgrade-offer")).toBeNull();
  });
});

describe("guide preview font layer (G06.10.b)", () => {
  test("the title renders the display family and the metadata/body the UI family, through the token mirror (AC1, AC4)", async () => {
    // jest-expo loads no font files: the assertions below run against the
    // not-yet-loaded faces — the readable render is the system-ui fallback
    // (AC4), the family values are the mirror's, never hardcoded strings.
    serve(CATALOG_FIXTURES);
    renderRouter(
      withPreviewRoutes(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 })),
      { initialUrl: "/route/guide-route-a1?from=rubric" },
    );
    const title = await screen.findByText("Гісторыі сукнараў: ад мытні да порта");
    expect(flatStyle(title).fontFamily).toBe(tokens.fontFamilyDisplay);
    // The big-text multiplier applies to the new families (AC4).
    expect(title.props.maxFontSizeMultiplier).toBe(tokens.fontBigTextFactor);
    // G06.10.c (issue #403): the fact's testID stays on the row (the one
    // accessibility element); the font contract reads the fact TEXT inside it.
    const durationText = screen.getByTestId("preview-duration-text");
    expect(flatStyle(durationText).fontFamily).toBe(tokens.fontFamilyUi);
    // The Proof: pointing the mirror's UI family back to system-ui fails this
    // assertion directly — the surface consumes the mirror's named face, not
    // the fallback name.
    expect(flatStyle(durationText).fontFamily).not.toBe("system-ui");
    expect(durationText.props.maxFontSizeMultiplier).toBe(tokens.fontBigTextFactor);
    // Strong interface text takes the named 600 face of the UI family.
    expect(flatStyle(screen.getByText("Мытня")).fontFamily).toBe(tokens.fontFamilyUiStrong);
    // Body text (the stop's announce) renders the UI family too.
    expect(flatStyle(screen.getByText("Першая гісторыя маршруту сукнараў.")).fontFamily).toBe(
      tokens.fontFamilyUi,
    );
  });

  test("the dragon-voice token resolves to the Caveat family (AC3)", () => {
    // The face is loaded by the root (components/fonts.ts); its first
    // interface surface is the dragon hint card (G07.04) — not this task.
    expect(tokens.fontFamilyDragon.startsWith("Caveat")).toBe(true);
  });
});

// G06.10.d (issue #404) — the clay buttons: the one main action of the
// screen carries the accent shelf of the canon tokens (through the token
// mirror — a hardcoded literal in the surfaces fails these assertions),
// the secondary actions take the line shade, and the disabled contract
// (canon §5: opacity 0.5, no dip, the reason next to the button) holds.
describe("guide preview clay buttons (G06.10.d)", () => {
  test("the primary action renders the accent shelf from the token mirror; the text pair is unchanged", async () => {
    serve(CATALOG_FIXTURES);
    renderRouter(withPreviewRoutes(createServices({
      catalogOrigin: "https://catalog.test",
      catalogSha256: sha256,
      bundlesStore: memoryBundles().store,
      downloadLayer: recordingDownload().downloadLayer,
    })), { initialUrl: "/route/guide-route-b1" });
    const button = await screen.findByTestId("btn-download");
    const style = flatStyle(button);
    expect(style.borderBottomWidth).toBe(4);
    expect(style.borderBottomColor).toBe(tokens.colorShelfAccent);
    // The text-on-accent pair (canon §2) is untouched by the shelf.
    const label = within(button).getByText("Загрузіць");
    expect(flatStyle(label).color).toBe(tokens.colorAccentInk);
  });

  test("the disabled primary keeps opacity 0.5, never dips, and the reason stays next to the button", async () => {
    serve(CATALOG_FIXTURES);
    renderRouter(
      withPreviewRoutes(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 })),
      { initialUrl: "/route/guide-route-a1?from=rubric" },
    );
    const button = await screen.findByTestId("btn-start");
    const resting = flatStyle(button);
    expect(resting.opacity).toBe(0.5);
    expect(resting.transform).toBeUndefined();
    expect(resting.borderBottomWidth).toBe(4);
    // A disabled press fires no dip: the style holds its resting shape.
    fireEvent.press(button);
    expect(flatStyle(screen.getByTestId("btn-start")).transform).toBeUndefined();
    expect(screen.getByText("Патрэбна пакупка.")).toBeTruthy();
  });

  test("the secondary actions render the line shade from the token mirror", async () => {
    serve(CATALOG_FIXTURES);
    renderInsufficientSpacePreview();
    fireEvent.press(await screen.findByTestId("btn-download"));
    await screen.findByTestId("download-error-banner");
    const retry = flatStyle(screen.getByTestId("btn-download-retry"));
    expect(retry.borderBottomWidth).toBe(4);
    expect(retry.borderBottomColor).toBe(tokens.colorShelfLine);
    const storage = flatStyle(screen.getByTestId("btn-download-storage"));
    expect(storage.borderBottomWidth).toBe(4);
    expect(storage.borderBottomColor).toBe(tokens.colorShelfLine);
  });

  test("the live walk's primary carries the accent shelf", async () => {
    renderRouter(withPreviewRoutes(createServices({
      runSession: { liveSession: () => ({ routeId: "route-map", title: "Каралеўская" }) },
    })), { initialUrl: "/explore" });
    const button = await screen.findByTestId("btn-walk-mode");
    const style = flatStyle(button);
    expect(style.borderBottomWidth).toBe(4);
    expect(style.borderBottomColor).toBe(tokens.colorShelfAccent);
  });
});

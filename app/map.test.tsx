// G07.01 (issue #281) — the Nearby surface render suite over the real
// composition root (rule 15): the published fixtures through the catalog
// service's integrity pin, the ONE LocationService instance the app owns,
// and the audio spy of the walk's session. The guards are the issue's proof:
// the proximity view orders by the published authored distance (criterion
// 1), the review list without a position is the honest manual browse
// (criterion 2), a radius entry and a card tap produce no audio event and no
// geofence window (criterion 3, R04 — fails if one is wired), a live walk
// keeps its own subscription (criterion 4), and the cards carry
// screen-reader labels (criterion 5).
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { act, fireEvent, renderRouter, screen, waitFor, within } from "expo-router/testing-library";
import { AppState, type AppStateStatus } from "react-native";
import { Svg } from "react-native-svg";

import Map from "./map";
import PlaceDetail from "./place/[id]";
import RoutePreview from "./route/[id]";
import { createServices } from "../controllers/createServices";
import { fixtureText, layoutWith, makeRunSession, serve, sha256 } from "../test/render-helpers";
import type { FakeAudioPlayerPort } from "../services/audio/fake-port";
import type { FakeLocationOsPort } from "../services/location/fake-port";

beforeEach(() => { AppState.currentState = "active"; });

const CATALOG_TEXT = fixtureText("catalog-with-discovery.json");
const INDEX_TEXT = fixtureText("index-valid.json");
const POINTER_PATH = "discovery/city-a/r-2026-09-14-1/index.json";

const withMapRoutes = (services: ReturnType<typeof createServices>) => ({
  _layout: layoutWith(services),
  map: Map,
  "place/[id]": PlaceDetail,
  "route/[id]": RoutePreview,
});

// The subscription commands the port recorded, split by kind — the arming
// discipline assertions read these (a sibling filter copy is a jscpd clone).
const startsOf = (port: FakeLocationOsPort): string[] =>
  port.commands.filter((command) => command.startsWith("start"));
const stopsOf = (port: FakeLocationOsPort): string[] =>
  port.commands.filter((command) => command.startsWith("stop"));

// The shared second half of the hand-over scenarios (11 §7: the named state
// never sticks): the walk ends, the surface re-arms within one poll and
// releases its own subscription on unmount — a sibling copy is a jscpd clone.
async function expectReArmAfterWalkEnds(
  env: ReturnType<typeof makeRunSession>,
  rendered: { unmount(): void },
): Promise<void> {
  act(() => {
    env.location.setMode("idle");
  });
  await waitFor(() => expect(screen.getByTestId("nearby-mode").props.children).toBe("Паблізу"), {
    timeout: 2000,
  });
  expect(env.location.currentMode()).toBe("city-surface");
  expect(startsOf(env.locationPort)).toEqual(["start 1", "start 2"]);

  rendered.unmount();
  expect(env.location.currentMode()).toBe("idle");
}

// The opened Nearby surface over the composition root: the published fixtures
// served, /map mounted, the offers on screen — the shared arrange of the
// scenarios (a sibling copy is a jscpd clone). With an env the surface gets
// its ONE location instance; `withRunSession` joins the walk's session (the
// audio spy beside the shared location) for the R04 and held-walk scenarios.
// The env's own ports stay the test's assertion handles.
async function openNearby(
  env?: ReturnType<typeof makeRunSession>,
  withRunSession = false,
): Promise<{ rendered: { unmount(): void }; services: ReturnType<typeof createServices> }> {
  const services = createServices({
    catalogOrigin: "https://catalog.test",
    catalogSha256: sha256,
    ...(env ? { location: env.location } : {}),
    ...(env && withRunSession ? { run: { session: env.session } } : {}),
  });
  serve({ "catalog.json": CATALOG_TEXT, [POINTER_PATH]: INDEX_TEXT });
  const rendered = renderRouter(withMapRoutes(services), { initialUrl: "/map" });
  // G21.17: the be UI shows only the be-text offers — a1-place is the
  // stable visible card to wait for.
  await screen.findByTestId("nearby-card-offer-a1-place");
  return { rendered, services };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Nearby surface (G07.01)", () => {
  // G21.17 (issue #551, AC1/AC5): the Nearby list shows only the offers whose
  // published text covers the selected UI language; a filtered-empty list is
  // the language explanation, never a service failure, and the switch back
  // restores the offers in place.
  test("G21.17: the offers filter by the selected UI language", async () => {
    const { services } = await openNearby();
    // The uk UI shows only the offer with published uk text; switching back
    // restores the be list in place.
    act(() => services.uiLocale.set("uk"));
    const ids = screen.getAllByTestId(/^nearby-card-/).map((card) => card.props.testID);
    expect(ids).toEqual(["nearby-card-offer-b1-guide"]);
    act(() => services.uiLocale.set("be"));
    expect(screen.getByTestId("nearby-card-offer-a1-place")).toBeTruthy();
  });

  test("G21.17: a valid catalogue without the selected language's text explains the language, not a failure", async () => {
    // The same published catalogue with every uk text fact removed — valid,
    // simply no uk text. The uk UI's honest empty is the language
    // explanation (a service failure renders its own state).
    const index = JSON.parse(INDEX_TEXT);
    for (const offer of index.offers) {
      offer.availability.text_locales = offer.availability.text_locales.filter((l: string) => l !== "uk");
    }
    const indexText = JSON.stringify(index);
    const catalog = JSON.parse(CATALOG_TEXT);
    catalog.discovery_index.sha256 = await sha256(new TextEncoder().encode(indexText));
    catalog.discovery_index.bytes = new TextEncoder().encode(indexText).length;
    serve({ "catalog.json": JSON.stringify(catalog), [POINTER_PATH]: indexText });
    const services = createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 });
    act(() => services.uiLocale.set("uk"));
    renderRouter(withMapRoutes(services), { initialUrl: "/map" });
    await screen.findByTestId("nearby-mode");
    // The uk catalogue is complete — the explanation renders in uk.
    expect(screen.getByTestId("nearby-message").props.children).toBe("Гідів з текстом цією мовою ще немає.");
    expect(screen.queryByTestId(/^nearby-card-/)).toBeNull();
  });

  test("without a position the surface renders the manual review list in the canon order", async () => {
    // No location port in the build (the adapter lands with G05.02.c) — the
    // review view is the honest default (criterion 2, no dead-end).
    await openNearby();
    expect(screen.getByTestId("nearby-mode").props.children).toBe("Агляд");
    // No location note without a location service.
    expect(screen.queryByTestId("nearby-location-note")).toBeNull();
    // The review order (21 §4 rule 6): editorial_order, offer_id tiebreak.
    const ids = screen.getAllByTestId(/^nearby-card-/).map((card) => card.props.testID);
    // G21.17: e1-place (en-only text) is hidden in the be UI — the filter
    // is the spec's «толькі гіды з тэкстам на выбранай мове».
    expect(ids).toEqual([
      "nearby-card-offer-b1-guide",
      "nearby-card-offer-a1-place",
      "nearby-card-offer-c1-place",
      "nearby-card-offer-g1-place",
      "nearby-card-offer-h1-place",
    ]);
    // The collection offer is not a Nearby card (G07.02 owns collections).
    expect(screen.queryByTestId("nearby-card-offer-f1-collection")).toBeNull();
  });

  test("with an allowed position the proximity view orders by the published distance", async () => {
    const env = makeRunSession();
    await openNearby(env);
    expect(screen.getByTestId("nearby-mode").props.children).toBe("Паблізу");
    // Nearest first by the authored distance; the unknown-distance offer
    // sorts after every known one — never a fabricated figure (P02).
    const ids = screen.getAllByTestId(/^nearby-card-/).map((card) => card.props.testID);
    expect(ids).toEqual([
      "nearby-card-offer-a1-place",
      "nearby-card-offer-g1-place",
      "nearby-card-offer-h1-place",
      "nearby-card-offer-b1-guide",
      "nearby-card-offer-c1-place",
    ]);
  });

  test("without the permission the surface names the state and stays on the review list", async () => {
    // The OS reports «denied» before the service exists — the constructor
    // reads it once (the fake port's state is the physical fact).
    const env = makeRunSession({ permission: "denied" });
    await openNearby(env);
    expect(screen.getByTestId("nearby-mode").props.children).toBe("Агляд");
    expect(screen.getByTestId("nearby-location-note").props.children).toBe(
      "Пазіцыя не дазволена — ручны агляд",
    );
    // The review order stands (criterion 2).
    const ids = screen.getAllByTestId(/^nearby-card-/).map((card) => card.props.testID);
    expect(ids[0]).toBe("nearby-card-offer-b1-guide");
  });

  test("a radius entry and a card tap start no audio and set no geofence window", async () => {
    // The walk's session is wired with the audio spy over the SAME location
    // instance — if the Nearby path ever triggered audio, the port would
    // record it (criterion 3's revert guard).
    const env = makeRunSession();
    const { rendered } = await openNearby(env, true);

    await waitFor(() => expect(startsOf(env.locationPort).length).toBe(1));

    // Radius entry: a fix lands near the city's places. The Nearby surface
    // owns no trigger machinery — the port's window stays empty and no audio
    // event exists.
    act(() => {
      env.locationPort.emitFix(1, { lat: 54.35, lng: 18.65, accuracy: 5, at: 0 });
    });
    expect(env.locationPort.regions.length).toBe(0);
    expect(env.audioPort.commands).toEqual([]);

    // A guide card leads to the guide preview — the explicit chain of
    // Journey 3 — and still starts nothing.
    fireEvent.press(screen.getByTestId("nearby-card-offer-b1-guide"));
    expect(await screen.findByTestId("screen-Route preview")).toBeTruthy();
    expect(env.audioPort.commands).toEqual([]);
  });

  test("a place card renders its facts and opens the place detail (G07.02 — Journey 3)", async () => {
    await openNearby();
    const place = await screen.findByTestId("nearby-card-offer-a1-place");
    // Criterion 5: the screen-reader label carries the card's facts and the
    // honest no-audio hint.
    expect(place.props.accessibilityLabel).toBe("Двор сукнараў, free");
    expect(place.props.accessibilityHint).toBe("Картка прапановы. Аўдыё не запускаецца.");
    // The facts line: an empty audio list renders the honest «—» — the
    // assertion fails on the dangling-label revert (implementation-rules 1).
    expect(within(place).getByText("Тэкст: be, en; аўдыё: —\n~20—30 хв")).toBeTruthy();
    // The Journey-3 chain: the place card opens the place detail — the tap
    // itself still starts no audio (R04; the teaser sounds only through the
    // detail's explicit Play).
    fireEvent.press(place);
    expect(await screen.findByTestId("screen-Place detail")).toBeTruthy();
    // The place detail's facts come from the same validated projection; the
    // honest empty-teasers state without a bundles store.
    expect(await screen.findByTestId("place-moments-empty")).toBeTruthy();
  });

  test("the surface arms the one subscription on open and releases it on close", async () => {
    const env = makeRunSession();
    const { rendered } = await openNearby(env);
    await waitFor(() => expect(env.locationPort.activeSubscriptions()).toBe(1));
    expect(env.location.currentMode()).toBe("city-surface");
    // Exactly one subscription start — no second owner (criterion 4).
    expect(startsOf(env.locationPort)).toEqual(["start 1"]);

    rendered.unmount();
    expect(stopsOf(env.locationPort)).toEqual(["stop 1"]);
    expect(env.location.currentMode()).toBe("idle");
    expect(env.locationPort.activeSubscriptions()).toBe(0);
  });

  test("a failing index degrades honestly: the named banner, no invented offers", async () => {
    // The catalog serves fine but its index file does not — the previous
    // valid truth is «прапаноў няма», never substitute content (21 §3.3).
    serve({ "catalog.json": CATALOG_TEXT });
    renderRouter(withMapRoutes(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 })), {
      initialUrl: "/map",
    });
    expect(await screen.findByTestId("nearby-degraded")).toBeTruthy();
    expect(screen.getByText("Індэкс прапаноў часова недаступны")).toBeTruthy();
    expect(screen.getByTestId("nearby-message").props.children).toBe("Прапановы пакуль не апублікаваны");
    expect(screen.queryByTestId(/^nearby-card-/)).toBeNull();
  });

  test("a catalog without the discovery pointer renders the honest empty state", async () => {
    serve({ "catalog.json": JSON.stringify({ catalog_schema_version: 1, routes: [] }) });
    renderRouter(withMapRoutes(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 })), {
      initialUrl: "/map",
    });
    await screen.findByTestId("nearby-mode");
    expect(screen.getByTestId("nearby-message").props.children).toBe("Прапановы пакуль не апублікаваны");
    expect(screen.queryByTestId("nearby-degraded")).toBeNull();
  });

  test("a walk that ends while the surface is open hands the subscription back", async () => {
    const env = makeRunSession();
    // A walk holds the subscription when the surface opens.
    env.location.setMode("active-guide");
    const { rendered } = await openNearby(env);
    expect(screen.getByTestId("nearby-mode").props.children).toBe("Агляд");
    expect(startsOf(env.locationPort)).toEqual(["start 1"]);

    await expectReArmAfterWalkEnds(env, rendered);
    // Closing the surface releases what IT armed; the walk's own End already
    // released the walk's subscription (stop 1 at the idle transition).
    expect(stopsOf(env.locationPort)).toEqual(["stop 1", "stop 2"]);
  });

  test("a walk that takes over an armed surface returns the subscription when it ends", async () => {
    const env = makeRunSession();
    const { rendered } = await openNearby(env);
    // The surface armed first (the only subscription in the port).
    expect(startsOf(env.locationPort)).toEqual(["start 1"]);

    // A walk starts while the surface stays mounted (the stack keeps it): the
    // walk's Start carries the subscription over — no second start — and the
    // surface honestly shows the held state.
    act(() => {
      env.location.setMode("active-guide");
    });
    await waitFor(() => expect(screen.getByTestId("nearby-mode").props.children).toBe("Агляд"), {
      timeout: 2000,
    });
    expect(startsOf(env.locationPort)).toEqual(["start 1"]);

    await expectReArmAfterWalkEnds(env, rendered);
  });

  test("a live walk keeps its subscription: Nearby neither arms nor releases it", async () => {
    const env = makeRunSession();
    // An active walk holds the subscription (the Run surface's mode).
    env.location.setMode("active-guide");
    expect(env.locationPort.activeSubscriptions()).toBe(1);
    const { rendered } = await openNearby(env, true);
    // No second subscription start, no mode change, the honest note.
    expect(startsOf(env.locationPort)).toEqual(["start 1"]);
    expect(env.location.currentMode()).toBe("active-guide");
    expect(screen.getByTestId("nearby-mode").props.children).toBe("Агляд");
    expect(screen.getByTestId("nearby-location-note").props.children).toBe(
      "Прагулка выкарыстоўвае пазіцыю — ручны агляд",
    );

    // Closing the surface leaves the walk's subscription alone.
    rendered.unmount();
    expect(stopsOf(env.locationPort)).toEqual([]);
    expect(env.location.currentMode()).toBe("active-guide");
    expect(env.locationPort.activeSubscriptions()).toBe(1);
  });

  // UX 01 (issue #347): the offer list scrolls — every card, the last of the
  // review order included, renders inside the surface's ScrollView instead
  // of being cut by the screen edge. Removing the ScrollView drops the
  // scroll testID and fails this (implementation-rules 1).
  test("the offer list scrolls: the last review-order card renders inside the ScrollView (UX 01)", async () => {
    await openNearby();
    expect(screen.getByTestId("scroll-nearby")).toBeTruthy();
    const ids = screen.getAllByTestId(/^nearby-card-/).map((card) => card.props.testID);
    expect(ids).toHaveLength(5);
    expect(ids[ids.length - 1]).toBe("nearby-card-offer-h1-place");
  });
});

// UX 07 (issue #353): the loading state shows the shared spinner next to the
// «Загрузка…» text — a never-resolving catalog fetch holds the surface in
// loading. Reverting the LoadingIndicator wiring in app/map.tsx turns this
// red (implementation-rules 1).
describe("Nearby loading indicator (UX 07)", () => {
  test("the loading state shows the ActivityIndicator next to the text", async () => {
    jest.spyOn(global, "fetch").mockImplementation(() => new Promise(() => {}));
    renderRouter(
      withMapRoutes(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 })),
      { initialUrl: "/map" },
    );
    expect(await screen.findByTestId("loading-indicator")).toBeTruthy();
    expect(screen.getByText("Загрузка…")).toBeTruthy();
  });
});

// UX 09 (issue #434): the card's offer kind is readable at a glance — the
// guide card carries the route marker beside the access badge, the place
// card the map-pin marker, and the marker element names the type for the
// screen reader (visual-language.md §9 — not a bare glyph). Removing the
// marker from NearbyCard, swapping the glyph or dropping the type word turns
// this red (implementation-rules 1).
describe("Nearby type markers (UX 09)", () => {
  test("guide cards carry a named route marker, place cards a named map-pin marker", async () => {
    await openNearby();
    const guideMarker = within(screen.getByTestId("nearby-card-offer-b1-guide")).getByTestId(
      "nearby-type-guide",
    );
    expect(guideMarker.props.accessibilityLabel).toBe("Гід");
    expect(within(guideMarker).UNSAFE_getByType(Svg).props.className).toBe("lucide lucide-route");
    const placeMarker = within(screen.getByTestId("nearby-card-offer-a1-place")).getByTestId(
      "nearby-type-place",
    );
    expect(placeMarker.props.accessibilityLabel).toBe("Месца");
    expect(within(placeMarker).UNSAFE_getByType(Svg).props.className).toBe("lucide lucide-map-pin");
  });
});

// G06.10.e (issue #405): the map is a canon-forbidden grain place — the
// painted tree never carries the grain layer (the import walk in
// test/design-tokens.test.mjs is the source-side guard). Granting the map
// the grain turns this red.
describe("Map paper grain (G06.10.e)", () => {
  test("the map surface never mounts the grain layer", async () => {
    renderRouter(withMapRoutes(createServices({})), { initialUrl: "/map" });
    expect(await screen.findByTestId("screen-Map")).toBeTruthy();
    // Neither the a11y tree (default queries) nor the render tree carries
    // the layer on the map.
    expect(screen.queryByTestId("paper-grain")).toBeNull();
    expect(screen.queryByTestId("paper-grain", { includeHiddenElements: true })).toBeNull();
  });
});

// Issue #523: the Nearby chrome words read the UI-locale switch (the #305
// store) instead of the binding's content-display locale — without the
// catalog service the fixed 'be' fallback kept «Побач» on screen after
// choosing English or Українська. The real store drives every case;
// reverting the useUiLocale wiring in app/map.tsx turns all three red
// (implementation-rules 1).
describe("Nearby UI-locale words (issue #523)", () => {
  test("without the service the chosen locale drives the title, the map note, the unavailable word and the back label", async () => {
    const services = createServices({});
    services.uiLocale.set("uk");
    renderRouter(withMapRoutes(services), { initialUrl: "/map" });
    expect(await screen.findByTestId("screen-Map")).toBeTruthy();
    expect(screen.getByText("Поруч")).toBeTruthy();
    expect(screen.getByText("Карта міста з’явиться після рішення про тайли")).toBeTruthy();
    expect(screen.getByTestId("nearby-error")).toBeTruthy();
    expect(screen.getByText("Каталог недоступний")).toBeTruthy();
    expect(screen.getByTestId("btn-map-back").props.accessibilityLabel).toBe("Назад");
    // No words of the other languages in these elements (criterion 1).
    expect(screen.queryByText("Побач")).toBeNull();
    expect(screen.queryByText("Каталог недаступны")).toBeNull();
  });

  test("switching the locale on the open surface rewords the chrome and arms no second GPS subscription", async () => {
    const env = makeRunSession();
    const { rendered, services } = await openNearby(env);
    expect(screen.getByText("Побач")).toBeTruthy();
    expect(startsOf(env.locationPort)).toEqual(["start 1"]);
    act(() => {
      services.uiLocale.set("en");
    });
    expect(screen.getByText("Nearby")).toBeTruthy();
    expect(screen.getByText("The city map arrives after the tiles decision")).toBeTruthy();
    expect(screen.getByTestId("nearby-mode").props.children).toBe("Near you");
    // en.back differs from the be default («← Назад») — the label itself
    // proves the switch reached the back element (review round 1).
    expect(screen.getByTestId("btn-map-back").props.accessibilityLabel).toBe("Back");
    expect(screen.queryByText("Побач")).toBeNull();
    // The switch re-rendered the words in place — the arming discipline
    // keeps the one subscription, the close releases what the surface armed.
    expect(startsOf(env.locationPort)).toEqual(["start 1"]);
    rendered.unmount();
    expect(stopsOf(env.locationPort)).toEqual(["stop 1"]);
  });

  test("with the connected service the authored content keeps its language while the chrome follows the switch", async () => {
    const { rendered, services } = await openNearby();
    const card = await screen.findByTestId("nearby-card-offer-a1-place");
    expect(within(card).getByText("Двор сукнараў")).toBeTruthy();
    expect(within(card).getByText("Тэкст: be, en; аўдыё: —\n~20—30 хв")).toBeTruthy();
    expect(within(card).getByText("Бясплатна")).toBeTruthy();
    act(() => {
      services.uiLocale.set("uk");
    });
    // G21.17: the uk UI shows only the offers with published uk text — the
    // b1 guide stays, the be/en-only a1-place filters out.
    const ukCard = screen.getByTestId("nearby-card-offer-b1-guide");
    // The chrome words follow the switch (criterion 3): the access badge
    // renders in uk...
    expect(screen.getByText("Поруч")).toBeTruthy();
    expect(within(ukCard).getByText("Платно")).toBeTruthy();
    // ...and the authored content keeps its language.
    expect(within(ukCard).getByText("Гісторыі сукнараў: ад мытні да порта")).toBeTruthy();
    rendered.unmount();
  });
});

describe("Nearby app lifecycle (G20.08)", () => {
  function appStates() {
    const listeners = new Set<(state: AppStateStatus) => void>();
    jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
      listeners.add(listener);
      return { remove: () => { listeners.delete(listener); } };
    });
    return {
      listeners,
      change(state: AppStateStatus) {
        AppState.currentState = state;
        act(() => { for (const listener of listeners) listener(state); });
      },
    };
  }

  test("nearby_background_foreground: stops its watch and resumes once without duplicates", async () => {
    const lifecycle = appStates();
    const env = makeRunSession();
    const { rendered } = await openNearby(env);
    expect(env.locationPort.activeSubscriptions()).toBe(1);
    lifecycle.change("background");
    expect(env.locationPort.activeSubscriptions()).toBe(0);
    expect(env.location.currentMode()).toBe("idle");
    act(() => { jest.advanceTimersByTime(1500); });
    expect(env.locationPort.activeSubscriptions()).toBe(0);
    lifecycle.change("active");
    lifecycle.change("active");
    expect(env.locationPort.activeSubscriptions()).toBe(1);
    expect(startsOf(env.locationPort)).toEqual(["start 1", "start 2"]);
    rendered.unmount();
    expect(env.locationPort.activeSubscriptions()).toBe(0);
    expect(lifecycle.listeners.size).toBe(0);
  });

  test("nearby_background_active_run: background and unmount preserve the walk owner", async () => {
    const lifecycle = appStates();
    const env = makeRunSession();
    const { rendered } = await openNearby(env);
    act(() => { env.location.setMode("active-guide"); });
    lifecycle.change("background");
    lifecycle.change("active");
    expect(env.location.currentMode()).toBe("active-guide");
    expect(env.locationPort.activeSubscriptions()).toBe(1);
    rendered.unmount();
    expect(env.locationPort.activeSubscriptions()).toBe(1);
    expect(stopsOf(env.locationPort)).toEqual([]);
    expect(lifecycle.listeners.size).toBe(0);
    env.location.setMode("idle");
  });

  test("nearby_disposed_callback: a removed lifecycle listener cannot restart location", async () => {
    const lifecycle = appStates();
    const env = makeRunSession();
    const { rendered } = await openNearby(env);
    const lateCallbacks = [...lifecycle.listeners];
    rendered.unmount();
    act(() => { for (const callback of lateCallbacks) callback("active"); });
    expect(env.locationPort.activeSubscriptions()).toBe(0);
    expect(env.location.currentMode()).toBe("idle");
  });

  test("nearby_initial_background: a mounted screen waits for foreground before arming", async () => {
    const lifecycle = appStates();
    AppState.currentState = "background";
    const env = makeRunSession();
    const { rendered } = await openNearby(env);
    expect(env.locationPort.activeSubscriptions()).toBe(0);
    lifecycle.change("active");
    expect(env.locationPort.activeSubscriptions()).toBe(1);
    rendered.unmount();
  });
});

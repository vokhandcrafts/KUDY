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
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";

import Map from "./map";
import RoutePreview from "./route/[id]";
import { createServices } from "../controllers/createServices";
import { fixtureText, layoutWith, makeRunSession, serve, sha256 } from "../test/render-helpers";

const CATALOG_TEXT = fixtureText("catalog-with-discovery.json");
const INDEX_TEXT = fixtureText("index-valid.json");
const POINTER_PATH = "discovery/city-a/r-2026-09-14-1/index.json";

const withMapRoutes = (services: ReturnType<typeof createServices>) => ({
  _layout: layoutWith(services),
  map: Map,
  "route/[id]": RoutePreview,
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Nearby surface (G07.01)", () => {
  test("without a position the surface renders the manual review list in the canon order", async () => {
    serve({ "catalog.json": CATALOG_TEXT, [POINTER_PATH]: INDEX_TEXT });
    // No location port in the build (the adapter lands with G05.02.c) — the
    // review view is the honest default (criterion 2, no dead-end).
    renderRouter(withMapRoutes(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 })), {
      initialUrl: "/map",
    });
    expect(await screen.findByTestId("nearby-mode")).toBeTruthy();
    expect(screen.getByTestId("nearby-mode").props.children).toBe("Агляд");
    // No location note without a location service.
    expect(screen.queryByTestId("nearby-location-note")).toBeNull();
    // The review order (21 §4 rule 6): editorial_order, offer_id tiebreak.
    const ids = screen.getAllByTestId(/^nearby-card-/).map((card) => card.props.testID);
    expect(ids).toEqual([
      "nearby-card-offer-b1-guide",
      "nearby-card-offer-a1-place",
      "nearby-card-offer-c1-place",
      "nearby-card-offer-e1-place",
      "nearby-card-offer-g1-place",
      "nearby-card-offer-h1-place",
    ]);
    // The collection offer is not a Nearby card (G07.02 owns collections).
    expect(screen.queryByTestId("nearby-card-offer-f1-collection")).toBeNull();
  });

  test("with an allowed position the proximity view orders by the published distance", async () => {
    serve({ "catalog.json": CATALOG_TEXT, [POINTER_PATH]: INDEX_TEXT });
    const { location } = makeRunSession();
    renderRouter(
      withMapRoutes(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256, location })),
      { initialUrl: "/map" },
    );
    await screen.findByTestId("nearby-mode");
    expect(screen.getByTestId("nearby-mode").props.children).toBe("Паблізу");
    // Nearest first by the authored distance; the unknown-distance offer
    // sorts after every known one — never a fabricated figure (P02).
    const ids = await screen.findAllByTestId(/^nearby-card-/);
    expect(ids.map((card) => card.props.testID)).toEqual([
      "nearby-card-offer-e1-place",
      "nearby-card-offer-a1-place",
      "nearby-card-offer-g1-place",
      "nearby-card-offer-h1-place",
      "nearby-card-offer-b1-guide",
      "nearby-card-offer-c1-place",
    ]);
  });

  test("without the permission the surface names the state and stays on the review list", async () => {
    serve({ "catalog.json": CATALOG_TEXT, [POINTER_PATH]: INDEX_TEXT });
    // The OS reports «denied» before the service exists — the constructor
    // reads it once (the fake port's state is the physical fact).
    const { location, locationPort } = makeRunSession({ permission: "denied" });
    renderRouter(
      withMapRoutes(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256, location })),
      { initialUrl: "/map" },
    );
    await screen.findByTestId("nearby-mode");
    expect(screen.getByTestId("nearby-mode").props.children).toBe("Агляд");
    expect(screen.getByTestId("nearby-location-note").props.children).toBe(
      "Пазіцыя не дазволена — ручны агляд",
    );
    // The review order stands (criterion 2).
    const ids = screen.getAllByTestId(/^nearby-card-/).map((card) => card.props.testID);
    expect(ids[0]).toBe("nearby-card-offer-b1-guide");
  });

  test("a radius entry and a card tap start no audio and set no geofence window", async () => {
    serve({
      "catalog.json": CATALOG_TEXT,
      [POINTER_PATH]: INDEX_TEXT,
      "bundle/guide-route-a1/1/route.json": fixtureText("route-guide-route-a1.json"),
    });
    // The walk's session is wired with the audio spy over the SAME location
    // instance — if the Nearby path ever triggered audio, the port would
    // record it (criterion 3's revert guard).
    const { session, locationPort, audioPort, location } = makeRunSession();
    renderRouter(
      withMapRoutes(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256, location, run: { session } })),
      { initialUrl: "/map" },
    );
    await screen.findByTestId("nearby-card-offer-e1-place");
    await waitFor(() => expect(locationPort.activeSubscriptions()).toBe(1));

    // Radius entry: a fix lands near the city's places. The Nearby surface
    // owns no trigger machinery — the port's window stays empty and no audio
    // event exists.
    act(() => {
      locationPort.emitFix(1, { lat: 54.35, lng: 18.65, accuracy: 5, at: 0 });
    });
    expect(locationPort.regions.length).toBe(0);
    expect(audioPort.commands).toEqual([]);

    // A guide card leads to the guide preview — the explicit chain of
    // Journey 3 — and still starts nothing.
    fireEvent.press(screen.getByTestId("nearby-card-offer-b1-guide"));
    expect(await screen.findByTestId("screen-Route preview")).toBeTruthy();
    expect(audioPort.commands).toEqual([]);
  });

  test("a place card renders its facts and navigates nowhere (G07.02 owns the detail)", async () => {
    serve({ "catalog.json": CATALOG_TEXT, [POINTER_PATH]: INDEX_TEXT });
    renderRouter(withMapRoutes(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 })), {
      initialUrl: "/map",
    });
    const place = await screen.findByTestId("nearby-card-offer-a1-place");
    // Criterion 5: the screen-reader label carries the card's facts and the
    // honest no-audio hint.
    expect(place.props.accessibilityLabel).toBe("Двор сукнараў, free");
    expect(place.props.accessibilityHint).toBe("Картка прапановы. Аўдыё не запускаецца.");
    // A place card is not a button: pressing it opens nothing.
    fireEvent.press(place);
    expect(screen.getByTestId("screen-Map")).toBeTruthy();
  });

  test("the surface arms the one subscription on open and releases it on close", async () => {
    serve({ "catalog.json": CATALOG_TEXT, [POINTER_PATH]: INDEX_TEXT });
    const { location, locationPort } = makeRunSession();
    const rendered = renderRouter(
      withMapRoutes(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256, location })),
      { initialUrl: "/map" },
    );
    await screen.findByTestId("nearby-card-offer-e1-place");
    await waitFor(() => expect(locationPort.activeSubscriptions()).toBe(1));
    expect(location.currentMode()).toBe("city-surface");
    // Exactly one subscription start — no second owner (criterion 4).
    expect(locationPort.commands.filter((command) => command.startsWith("start"))).toEqual(["start 1"]);

    rendered.unmount();
    expect(locationPort.commands.filter((command) => command.startsWith("stop"))).toEqual(["stop 1"]);
    expect(location.currentMode()).toBe("idle");
    expect(locationPort.activeSubscriptions()).toBe(0);
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

  test("a live walk keeps its subscription: Nearby neither arms nor releases it", async () => {
    serve({ "catalog.json": CATALOG_TEXT, [POINTER_PATH]: INDEX_TEXT });
    const { session, location, locationPort } = makeRunSession();
    // An active walk holds the subscription (the Run surface's mode).
    location.setMode("active-guide");
    expect(locationPort.activeSubscriptions()).toBe(1);
    const rendered = renderRouter(
      withMapRoutes(
        createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256, location, run: { session } }),
      ),
      { initialUrl: "/map" },
    );
    await screen.findByTestId("nearby-card-offer-e1-place");
    // No second subscription start, no mode change, the honest note.
    expect(locationPort.commands.filter((command) => command.startsWith("start"))).toEqual(["start 1"]);
    expect(location.currentMode()).toBe("active-guide");
    expect(screen.getByTestId("nearby-mode").props.children).toBe("Агляд");
    expect(screen.getByTestId("nearby-location-note").props.children).toBe(
      "Прагулка выкарыстоўвае пазіцыю — ручны агляд",
    );

    // Closing the surface leaves the walk's subscription alone.
    rendered.unmount();
    expect(locationPort.commands.filter((command) => command.startsWith("stop"))).toEqual([]);
    expect(location.currentMode()).toBe("active-guide");
    expect(locationPort.activeSubscriptions()).toBe(1);
  });
});

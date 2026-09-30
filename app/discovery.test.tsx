// G15.03 (issue #70) — the discovery surfaces' render tests: the real
// production screens over the real services with the fixture fetch mock —
// the same wiring the composition root performs (rule 15). Covers the
// D-scenarios the surface can prove: exact results alone (D02/D04), a narrow
// query with labeled alternatives (D04), the paid badge without a fabricated
// price (D06), and the collection members with the overlap note and no audio
// (NAV11, D07). The place member's own surface is app/place's suite (G07.02)
// — here only the transition from the result card is proven.
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { fireEvent, renderRouter, screen } from "expo-router/testing-library";

import Collection from "./collection/[id]";
import Discovery from "./discovery";
import Explore from "./(tabs)/explore";
import PlaceDetail from "./place/[id]";
import { ServicesContext } from "./_layout";
import { createServices } from "../controllers/createServices";
import type { DiscoveryOfferEvent } from "../controllers/useDiscoveryController";
import { CATALOG_POINTER, fixtureText, layoutWith, serve, sha256 } from "../test/render-helpers";

// The published fixtures (fixtures/discovery-contract): the catalog pointer
// declares the index's size and sha256, so the served texts pass the real
// integrity pin of the index reader.
const CATALOG_TEXT = fixtureText("catalog-with-discovery.json");
const INDEX_TEXT = fixtureText("index-valid.json");

function memorySnapshot() {
  let bytes: Uint8Array | null = null;
  return {
    read: async () => bytes,
    write: async (next: Uint8Array) => {
      bytes = next;
    },
  };
}

function analyticsPort() {
  const events: DiscoveryOfferEvent[] = [];
  return {
    events,
    offerShown: (event: DiscoveryOfferEvent) => void events.push(event),
    offerOpened: (event: DiscoveryOfferEvent) => void events.push(event),
  };
}

const withDiscoveryRoutes = (layout: ReturnType<typeof layoutWith>) => ({
  _layout: layout,
  "(tabs)/explore": Explore,
  discovery: Discovery,
  "collection/[id]": Collection,
  "place/[id]": PlaceDetail,
});

function renderDiscovery(initialUrl: string) {
  const analytics = analyticsPort();
  // The mock installs before the services construct: the controllers boot at
  // construction (09 §4), so the first fetch must already be served.
  serve({ "catalog.json": CATALOG_TEXT, [CATALOG_POINTER]: INDEX_TEXT });
  const services = createServices({
    catalogOrigin: "https://cdn.test",
    catalogSha256: sha256,
    discoverySnapshot: memorySnapshot(),
    discoveryAnalytics: analytics,
  });
  renderRouter(withDiscoveryRoutes(layoutWith(services)), { initialUrl });
  return analytics;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Discovery result surface", () => {
  test("exact results render alone, paid badge only, no fabricated price (D02/D06)", async () => {
    const analytics = renderDiscovery("/discovery");
    expect(await screen.findByTestId("offer-card-offer-b1-guide")).toBeTruthy();
    expect(screen.getByTestId("offer-card-offer-a1-place")).toBeTruthy();
    // The en-only place cannot answer a be query — it never renders (20 §3).
    expect(screen.queryByTestId("offer-card-offer-e1-place")).toBeNull();
    expect(screen.getByTestId("badge-access-paid")).toBeTruthy();
    // The price comes from the store through the payment service (20 §6) —
    // the card invents no number, and unknown is never zero.
    expect(screen.queryByText("0 zł")).toBeNull();
    // The rendered offers recorded their shown events with the allowlisted
    // payload (21 §7).
    expect(
      analytics.events.some((event) => event.surface === "discovery" && event.offer_id === "offer-b1-guide"),
    ).toBe(true);
  });

  test("a narrow query shows the honest empty message with labeled alternatives (D04)", async () => {
    renderDiscovery("/discovery");
    await screen.findByTestId("offer-card-offer-b1-guide");
    fireEvent.press(screen.getByTestId("time-60"));
    fireEvent.press(screen.getByTestId("theme-theme-sea"));
    expect(await screen.findByTestId("discovery-empty")).toBeTruthy();
    const alternatives = screen.getByTestId("discovery-alternatives");
    expect(alternatives).toBeTruthy();
    // Both sea offers stay visible with their differences; nothing is
    // silently widened or dropped.
    expect(screen.getByTestId("offer-card-offer-c1-place")).toBeTruthy();
    expect(screen.getByTestId("offer-card-offer-f1-collection")).toBeTruthy();
  });

  test("the Explore entry opens discovery and Back returns to the city (NAV9)", async () => {
    renderDiscovery("/explore");
    expect(await screen.findByTestId("screen-Explore")).toBeTruthy();
    fireEvent.press(screen.getByTestId("link-discovery"));
    expect(await screen.findByTestId("screen-Discovery")).toBeTruthy();
    fireEvent.press(screen.getByTestId("btn-discovery-back"));
    expect(await screen.findByTestId("screen-Explore")).toBeTruthy();
  });

  test("a place result card opens the place surface (21 §3.1, NAV9)", async () => {
    renderDiscovery("/discovery");
    fireEvent.press(await screen.findByTestId("offer-card-offer-a1-place"));
    expect(await screen.findByTestId("screen-Place detail")).toBeTruthy();
  });
});

describe("Collection card (падборка)", () => {
  test("members render with the mixed badge and the overlap note; no audio (NAV11/D07)", async () => {
    renderDiscovery("/collection/collection-f1");
    expect(await screen.findByTestId("screen-Collection")).toBeTruthy();
    expect(screen.getByTestId("collection-overlap-note")).toBeTruthy();
    // The guide member is the same card that opens the same preview (D02).
    expect(screen.getByTestId("guide-card-guide-route-a1")).toBeTruthy();
    expect(screen.getByTestId("badge-access-mixed")).toBeTruthy();
    // A collection has no audio: the listen button does not exist (21 §3.2).
    expect(screen.queryByText(/паслухаць/i)).toBeNull();
  });
});

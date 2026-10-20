import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { renderRouter, screen } from "expo-router/testing-library";
import { act } from "@testing-library/react-native";
import { Dimensions, FlatList, type ScaledSize } from "react-native";

import Explore from "./(tabs)/explore";
import Guides from "./city/[id]/guides";
import RoutePreview from "./route/[id]";
import { createServices } from "../controllers/createServices";
import type { CatalogGuideCard } from "../controllers/catalog/catalogController";
import { flatStyle, layoutWith, sha256 } from "../test/render-helpers";

const catalog = JSON.stringify({
  catalog_schema_version: 1,
  routes: Array.from({ length: 100 }, (_, index) => ({
    route_id: `guide-${String(index + 1).padStart(3, "0")}`,
    version: "1",
    locales: ["be"],
    layers: ["base"],
  })),
});

async function openCatalog(
  path: "/explore" | "/city/gdansk/guides",
  width: number,
  fontScale = 1,
  shouldFail: () => boolean = () => false,
) {
  jest.spyOn(Dimensions, "get").mockReturnValue({ width, height: 875, scale: 3, fontScale } as ScaledSize);
  const services = createServices({
    catalogLoader: async (relPath) => {
      if (relPath === "catalog.json") {
        if (shouldFail()) throw new Error("synthetic catalog outage");
        return catalog;
      }
      throw new Error(`missing synthetic file: ${relPath}`);
    },
    catalogSha256: sha256,
  });
  await services.catalog?.controller.getState().refresh();
  renderRouter(
    { _layout: layoutWith(services), "(tabs)/explore": Explore, "city/[id]/guides": Guides, "route/[id]": RoutePreview },
    { initialUrl: path },
  );
  return services;
}

function catalogList(id: string): FlatList<CatalogGuideCard> {
  const lists = screen.UNSAFE_getAllByType(FlatList);
  const list = lists.find((candidate) => candidate.props.testID === id);
  if (list === undefined) throw new Error(`missing ${id}`);
  return list as FlatList<CatalogGuideCard>;
}

afterEach(() => { jest.restoreAllMocks(); });

describe("G20.34 catalog scroll structure", () => {
  test.each([
    { path: "/explore", listId: "scroll-explore", source: "city" },
    { path: "/city/gdansk/guides", listId: "scroll-guides", source: "rubric" },
  ] as const)("$path keeps all 100 guides in one virtualized list", async ({ path, listId, source }) => {
    await openCatalog(path, 411);
    await screen.findByTestId("guide-card-guide-001");
    const list = catalogList(listId);
    const cards = list.props.data as readonly CatalogGuideCard[];
    expect(cards).toHaveLength(100);
    expect(cards.map((card) => card.routeId)).toEqual(
      Array.from({ length: 100 }, (_, index) => `guide-${String(index + 1).padStart(3, "0")}`),
    );
    expect(new Set(cards.map((card) => list.props.keyExtractor?.(card, 0))).size).toBe(100);
    expect(list.props.initialNumToRender).toBeLessThan(100);
    expect(list.props.numColumns).toBe(1);
    expect(list.props.ListHeaderComponent).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(FlatList)).toHaveLength(1);
    expect(list.props.renderItem).toBeDefined();
    if (source === "city") expect(screen.getByTestId("link-guides")).toBeTruthy();
    else expect(screen.getByTestId("btn-guides-back")).toBeTruthy();
  });

  test("the 821px threshold uses two columns with unique route keys", async () => {
    await openCatalog("/explore", 821);
    await screen.findByTestId("guide-card-guide-001");
    const list = catalogList("scroll-explore");
    expect(list.props.numColumns).toBe(2);
    expect(list.props.columnWrapperStyle).toBeTruthy();
    expect(list.props.data).toHaveLength(100);
  });

  test("changing width across 821px keeps the list usable", async () => {
    await openCatalog("/explore", 820);
    await screen.findByTestId("guide-card-guide-001");
    expect(catalogList("scroll-explore").props.numColumns).toBe(1);
    const wide = { width: 821, height: 875, scale: 3, fontScale: 1 };
    jest.restoreAllMocks();
    act(() => Dimensions.set({ window: wide, screen: wide }));
    expect(catalogList("scroll-explore").props.numColumns).toBe(2);
    expect(catalogList("scroll-explore").props.data).toHaveLength(100);
    expect(screen.getByTestId("guide-card-guide-001")).toBeTruthy();
  });

  test("narrow large-text layout keeps the header and cards in the scroll owner", async () => {
    await openCatalog("/explore", 320, 2);
    await screen.findByTestId("guide-card-guide-001");
    const list = catalogList("scroll-explore");
    expect(list.props.numColumns).toBe(1);
    expect(flatStyle({ props: { style: list.props.style } }).flex).toBe(1);
    expect(screen.getByText("Гданьск").props.maxFontSizeMultiplier).toBe(1.25);
    expect(screen.getByTestId("link-nearby")).toBeTruthy();
  });

  test("locale switching filters and restores the virtualized data", async () => {
    const services = await openCatalog("/explore", 411);
    await screen.findByTestId("guide-card-guide-001");
    await act(async () => {
      services.uiLocale.set("fr");
      await services.catalog?.controller.getState().refresh();
    });
    expect(catalogList("scroll-explore").props.data).toHaveLength(0);
    expect(screen.getByTestId("city-message")).toBeTruthy();
    await act(async () => {
      services.uiLocale.set("be");
      await services.catalog?.controller.getState().refresh();
    });
    expect(catalogList("scroll-explore").props.data).toHaveLength(100);
  });

  test("an offline refresh keeps cached rows and the notice in the same scroll owner", async () => {
    let offline = false;
    const services = await openCatalog("/explore", 411, 1, () => offline);
    await screen.findByTestId("guide-card-guide-001");
    offline = true;
    await act(async () => { await services.catalog?.controller.getState().refresh(); });
    expect(services.catalog?.controller.getState().surface.kind).toBe("offline");
    expect(catalogList("scroll-explore").props.data).toHaveLength(100);
    expect(screen.getByTestId("catalog-banner")).toBeTruthy();
    expect(screen.getByTestId("link-guides")).toBeTruthy();
  });

  test("the final virtualized row carries the rubric preview route", async () => {
    await openCatalog("/city/gdansk/guides", 411);
    await screen.findByTestId("guide-card-guide-001");
    const list = catalogList("scroll-guides");
    const last = (list.props.data as readonly CatalogGuideCard[])[99];
    const row = list.props.renderItem?.({
      item: last,
      index: 99,
      separators: { highlight: () => {}, unhighlight: () => {}, updateProps: () => {} },
    });
    expect(row).toMatchObject({ props: { children: { props: { card: { routeId: "guide-100" }, from: "rubric" } } } });
  });
});

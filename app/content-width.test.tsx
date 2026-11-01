// APR-10.b (issue #959) — the ≥600dp content-width cap over the real
// screens (rule 15): the canon token content.max-width caps the catalog
// body (explore, guides), the My KUDY settings list and the guide preview
// at 800dp and 1280dp. Removing the cap from any of the four surfaces turns
// this red (implementation-rules 1); the token mirror's canon equality is
// the design-tokens guard's own test/design-tokens.test.mjs pin.
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { renderRouter, screen } from "expo-router/testing-library";
import { Dimensions, type ScaledSize } from "react-native";

import Explore from "./(tabs)/explore";
import My from "./(tabs)/my";
import Guides from "./city/[id]/guides";
import RoutePreview from "./route/[id]";
import { tokens } from "../components/design-tokens";
import { createServices } from "../controllers/createServices";
import { CATALOG_FIXTURES, layoutWith, serve, sha256 } from "../test/render-helpers";

// The smallest published catalog the two city surfaces render honestly
// (both fixture guides carry the display-locale text, so both stay visible).
const catalog = JSON.stringify({
  catalog_schema_version: 1,
  routes: [
    { route_id: "guide-001", version: "1", locales: ["be"], layers: ["base"] },
    { route_id: "guide-002", version: "1", locales: ["be"], layers: ["base"] },
  ],
});

function atWidth(width: number): void {
  jest.spyOn(Dimensions, "get").mockReturnValue({ width, height: 875, scale: 3, fontScale: 1 } as ScaledSize);
}

// The effective contentContainer style: the surfaces pass a single object or
// a merged array, the cap fields must survive the merge.
function flatContent(style: unknown): Record<string, unknown> {
  return [style]
    .flat(Infinity)
    .filter((part) => part !== null && part !== undefined && typeof part === "object")
    .reduce<Record<string, unknown>>((acc, part) => ({ ...acc, ...(part as Record<string, unknown>) }), {});
}

// Both list kinds carry their content width as one testID'd prop — the FlatList
// of the city surfaces and My KUDY, the ScrollView of the preview.
function expectCap(testID: string): void {
  const element = screen.UNSAFE_getByProps({ testID });
  expect(flatContent(element.props.contentContainerStyle)).toMatchObject({
    maxWidth: tokens.contentMaxWidth,
    alignSelf: "center",
  });
}

// The city surfaces' shared arrange: the published synthetic catalog over the
// real services, mounted at the requested surface (a sibling copy would be a
// jscpd clone — implementation-rules 3).
async function openCitySurface(path: "/explore" | "/city/gdansk/guides"): Promise<void> {
  const services = createServices({
    catalogLoader: async (relPath) => {
      if (relPath === "catalog.json") return catalog;
      throw new Error(`missing synthetic file: ${relPath}`);
    },
    catalogSha256: sha256,
  });
  await services.catalog?.controller.getState().refresh();
  renderRouter(
    {
      _layout: layoutWith(services),
      "(tabs)/explore": Explore,
      "city/[id]/guides": Guides,
    },
    { initialUrl: path },
  );
  await screen.findByTestId("guide-card-guide-001");
}

afterEach(() => { jest.restoreAllMocks(); });

describe("APR-10.b (issue #959): the canon content width on wide windows", () => {
  test.each([
    { surface: "/explore", testID: "scroll-explore" },
    { surface: "/city/gdansk/guides", testID: "scroll-guides" },
  ] as const)("$surface body caps at 800 and 1280 dp", async ({ surface, testID }) => {
    for (const width of [800, 1280]) {
      atWidth(width);
      await openCitySurface(surface);
      expectCap(testID);
    }
  });

  test.each([800, 1280])("the My KUDY settings content caps at %i dp", async (width) => {
    atWidth(width);
    renderRouter({ _layout: layoutWith(createServices({})), "(tabs)/my": My }, { initialUrl: "/my" });
    await screen.findByTestId("my-ui-locale");
    expectCap("scroll-my");
  });

  test.each([800, 1280])("the guide preview content caps at %i dp", async (width) => {
    atWidth(width);
    serve(CATALOG_FIXTURES);
    renderRouter(
      {
        _layout: layoutWith(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 })),
        "route/[id]": RoutePreview,
      },
      { initialUrl: "/route/guide-route-b1" },
    );
    await screen.findByTestId("scroll-preview");
    expectCap("scroll-preview");
  });
});

// #436: render the production screens under a dark system scheme. These
// assertions fail if a surface reverts to light-only card or frame styles.
import { afterEach, expect, jest, test } from "@jest/globals";
import { renderRouter, screen, within } from "expo-router/testing-library";
import { render } from "@testing-library/react-native";
import { Svg } from "react-native-svg";
import MapPinIcon from "lucide-react-native/icons/map-pin";

import Collection from "./collection/[id]";
import Discovery from "./discovery";
import { CanonIcon } from "../components/canon-icon";
import { darkTokens } from "../components/design-tokens";
import { createServices } from "../controllers/createServices";
import { CATALOG_FIXTURES, CATALOG_POINTER, flatStyle, frameRoutes, layoutWith, serve, sha256 } from "../test/render-helpers";

// React Native re-exports this hook from its Utilities module. Mocking that
// module exercises the real theme hook and the actual rendered screen styles.
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
  __esModule: true,
  default: () => "dark",
}));

afterEach(() => {
  jest.restoreAllMocks();
});

function openDiscovery(url: string) {
  serve({ "catalog.json": CATALOG_FIXTURES["catalog.json"], [CATALOG_POINTER]: CATALOG_FIXTURES[CATALOG_POINTER] });
  let cached: Uint8Array | null = null;
  const services = createServices({
    catalogOrigin: "https://cdn.test",
    catalogSha256: sha256,
    discoverySnapshot: {
      read: async () => cached,
      write: async (next: Uint8Array) => { cached = next; },
    },
    discoveryAnalytics: { offerShown: () => {}, offerOpened: () => {} },
  });
  renderRouter({
    _layout: layoutWith(services),
    discovery: Discovery,
    "collection/[id]": Collection,
  }, { initialUrl: url });
}

test("Nearby chrome and Back icon use dark tokens while the map preview remains light", async () => {
  const previous = process.env.EXPO_PUBLIC_DEMO_MODE;
  process.env.EXPO_PUBLIC_DEMO_MODE = "1";
  try {
    renderRouter(frameRoutes(), { initialUrl: "/map" });
    const root = await screen.findByTestId("screen-Map");
    expect(flatStyle(root).backgroundColor).toBe(darkTokens.colorPaper);
    const back = screen.getByTestId("btn-map-back");
    expect(within(back).UNSAFE_getByType(Svg).props.stroke).toBe(darkTokens.colorAccent);
    const map = screen.getByTestId("nearby-demo-map");
    expect(flatStyle(map).backgroundColor).toBe("#eaf1eb");
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_DEMO_MODE;
    else process.env.EXPO_PUBLIC_DEMO_MODE = previous;
  }
});

test("Discovery offer card background and title contrast follow dark tokens", async () => {
  openDiscovery("/discovery");
  const card = await screen.findByTestId("offer-card-offer-b1-guide");
  expect(flatStyle(card).backgroundColor).toBe(darkTokens.colorCard);
  const title = within(card).getAllByText(/.+/)[0];
  expect(flatStyle(title).color).toBe(darkTokens.colorMuted);
});

test("Collection place member card uses dark background and text", async () => {
  openDiscovery("/collection/collection-f1");
  const card = await screen.findByTestId("collection-member-offer-a1-place");
  expect(flatStyle(card).backgroundColor).toBe(darkTokens.colorCard);
  const title = within(card).getAllByText(/.+/)[0];
  expect(flatStyle(title).color).toBe(darkTokens.colorMuted);
});

test("CanonIcon default glyph color resolves from the dark palette", () => {
  const icon = render(<CanonIcon glyph={MapPinIcon} label="Кропка" />);
  expect(icon.UNSAFE_getByType(Svg).props.stroke).toBe(darkTokens.colorInk);
});

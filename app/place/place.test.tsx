// G07.02 (issue #282) — the place detail render suite over the real
// composition root (rule 15): the published fixtures through the catalog
// service's integrity pin, the moment teasers from a fake bundles store, and
// the ONE AudioService instance the moment play binding owns. The guards are
// the issue's criteria: the teaser sounds only through the explicit Play
// (criterion 1 — the ownership outcomes and named refusals render honestly),
// the guide link opens the PREVIEW, never Start (criterion 2), the teaser is
// the public base content — the paid gating stays the preview screen's own
// (criterion 3), and Back returns with the playback context alive
// (criterion 4).
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";

import PlaceDetail from "./[id]";
// NOT `Map` — the import would shadow the global Map constructor the fake
// stores below construct (`new Map(...)` would render the screen instead).
import MapScreen from "../map";
import RoutePreview from "../route/[id]";
import { createServices } from "../../controllers/createServices";
import { fixtureText, layoutWith, serve, sha256 } from "../../test/render-helpers";
import { AudioService } from "../../services/audio/service";
import { FakeAudioPlayerPort } from "../../services/audio/fake-port";
import type { BundlesStore, FileFacts } from "../../services/contentRepo/types";

const CATALOG_TEXT = fixtureText("catalog-with-discovery.json");
const INDEX_TEXT = fixtureText("index-valid.json");
const POINTER_PATH = "discovery/city-a/r-2026-09-14-1/index.json";
const MOMENT_PATH = "bundles/route-a1/1/be/base/audio/s-a1.m4a";

// The downloaded package of route-a1: the root moments manifest names N
// place-a1 teasers (one by default); the base layer carries their texts and
// their audio files. The scroll scenario (UX 01) passes 5; the first teaser
// keeps the original text the other tests assert.
class MomentStore implements BundlesStore {
  private readonly dirs: Map<string, string[]>;
  private readonly files: Map<string, FileFacts>;

  constructor(momentCount = 1) {
    const moments = Array.from({ length: momentCount }, (_, i) => ({
      id: `m-a${i + 1}`,
      place_id: "place-a1",
      story_id: `s-a${i + 1}`,
      kind: "teaser",
      cooldown_min: 60,
    }));
    const teaserText = (storyId: string): string =>
      storyId === "s-a1" ? "Тэйзер двара сукнараў" : `Тэйзер моманту ${storyId}`;
    this.dirs = new Map<string, string[]>([
      ["bundles", ["route-a1"]],
      ["bundles/route-a1", ["1"]],
    ]);
    this.files = new Map<string, FileFacts>([
      [
        "bundles/route-a1/1/moments.json",
        { kind: "present", bytes: new TextEncoder().encode(JSON.stringify(moments)) },
      ],
      [
        "bundles/route-a1/1/be/base/stops.json",
        {
          kind: "present",
          bytes: new TextEncoder().encode(
            JSON.stringify(moments.map((moment) => ({ story_id: moment.story_id, text: teaserText(moment.story_id) }))),
          ),
        },
      ],
      ...moments.map((moment): [string, FileFacts] => [
        `bundles/route-a1/1/be/base/audio/${moment.story_id}.m4a`,
        { kind: "present", bytes: new TextEncoder().encode("audio") },
      ]),
    ]);
  }

  listDir(rel: string): Promise<string[] | null> {
    return Promise.resolve(this.dirs.get(rel) ?? null);
  }
  readFile(rel: string): Promise<FileFacts> {
    return Promise.resolve(this.files.get(rel) ?? { kind: "absent" });
  }
  statSize(): Promise<number | null> {
    return Promise.resolve(null);
  }
}

const withPlaceRoutes = (services: ReturnType<typeof createServices>) => ({
  _layout: layoutWith(services),
  map: MapScreen,
  "place/[id]": PlaceDetail,
  "route/[id]": RoutePreview,
});

// The composition root of one scenario: the ONE AudioService over the test's
// port, the teasers store, the fixtures' catalog — the shared arrange (a
// sibling copy is a jscpd clone). The audio instance returns for scenarios
// that hold a foreign launch before the screen opens.
function placeServices(audioPort: FakeAudioPlayerPort, momentCount = 1): {
  services: ReturnType<typeof createServices>;
  audio: AudioService;
} {
  const audio = new AudioService({ createPort: () => audioPort });
  return {
    services: createServices({
      catalogOrigin: "https://catalog.test",
      catalogSha256: sha256,
      bundlesStore: new MomentStore(momentCount),
      audio,
    }),
    audio,
  };
}

// The opened place detail over the composition root: the published fixtures
// served, the teasers on screen — the shared arrange of the scenarios.
async function openPlace(): Promise<{ audioPort: FakeAudioPlayerPort }> {
  const audioPort = new FakeAudioPlayerPort();
  serve({ "catalog.json": CATALOG_TEXT, [POINTER_PATH]: INDEX_TEXT });
  renderRouter(withPlaceRoutes(placeServices(audioPort).services), { initialUrl: "/place/place-a1" });
  await screen.findByTestId("place-moment-m-a1");
  return { audioPort };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Place detail surface (G07.02)", () => {
  test("the detail renders the place facts and the teaser card with its explicit Play", async () => {
    await openPlace();
    // The facts line of the validated projection (the honest «—» for the
    // audio-less place offer — the same string the Nearby card renders).
    expect(screen.getByText("Тэкст: be, en; аўдыё: —")).toBeTruthy();
    // The teaser card: the manifest's teaser text and the Play affordance.
    expect(screen.getByText("Тэйзер двара сукнараў")).toBeTruthy();
    const play = screen.getByTestId("place-moment-play-m-a1");
    expect(play.props.accessibilityLabel).toBe("Паслухаць тэйзер");
    expect(screen.queryByTestId("place-nofacts")).toBeNull();
  });

  test("the explicit Play launches the teaser through the ONE player — the card shows the honest now-playing", async () => {
    const { audioPort } = await openPlace();
    // The physical fact the player reports once the source is active.
    audioPort.snapshotValue = { state: "playing", positionMs: 0, durationMs: 60000 };
    fireEvent.press(screen.getByTestId("place-moment-play-m-a1"));
    await waitFor(() => expect(screen.getByTestId("place-moment-live-m-a1").props.children).toBe("Зараз грае"));
    expect(audioPort.commands).toEqual([`play 1:${MOMENT_PATH}`]);

    // The same tap now stops by command (never finished — the toggle reads
    // the live fact, the ownership decisions stay in the controller).
    fireEvent.press(screen.getByTestId("place-moment-play-m-a1"));
    await waitFor(() => expect(screen.queryByTestId("place-moment-live-m-a1")).toBeNull());
    expect(audioPort.commands).toEqual([`play 1:${MOMENT_PATH}`, "stop"]);
  });

  test("the guide link opens the guide's PREVIEW, never Start (criterion 2)", async () => {
    await openPlace();
    const link = screen.getByTestId("place-moment-guide-m-a1");
    expect(link.props.accessibilityLabel).toBe("Прэв'ю гіда");
    expect(link.props.accessibilityHint).toBe("Адкрывае прэв'ю гіда, не запуск прагулкі.");
    // The moment's own package route — the preview screen's gating owns the
    // locked protection (criterion 3).
    expect(link.props.href).toBe("/route/route-a1");
    fireEvent.press(link);
    expect(await screen.findByTestId("screen-Route preview")).toBeTruthy();
  });

  test("a play over a session-owned player renders the named refusal — no second player", async () => {
    const audioPort = new FakeAudioPlayerPort();
    const { services, audio } = placeServices(audioPort);
    // A foreign (session-owned) guide launch holds the ONE player before the
    // screen opens; the port's scripted snapshot reports the physical fact.
    void audio.play({ token: { kind: "guide", ref: "walk-1", seq: 1 }, path: "be/base/audio/a.m4a" });
    audioPort.snapshotValue = { state: "playing", positionMs: 0, durationMs: 9000 };
    serve({ "catalog.json": CATALOG_TEXT, [POINTER_PATH]: INDEX_TEXT });
    renderRouter(withPlaceRoutes(services), { initialUrl: "/place/place-a1" });
    await screen.findByTestId("place-moment-m-a1");

    // The play tap refuses through the controller's decision — the screen
    // renders the refusal's own words (G06.05: the raw code never shows),
    // the port records no second play.
    fireEvent.press(screen.getByTestId("place-moment-play-m-a1"));
    await waitFor(() =>
      expect(screen.getByTestId("place-moment-refusal-m-a1").props.children).toBe(
        "Тэйзер не гучыць у прагулцы — запусціце яго тут яшчэ раз",
      ),
    );
    expect(audioPort.commands).toEqual(["play 1:be/base/audio/a.m4a"]);
  });

  test("Back returns to Побач; the playback context survives the navigation (criterion 4)", async () => {
    // The real Journey-3 chain: Побач → месца — the back stack exists only
    // when the place detail opens from the Nearby surface.
    const audioPort = new FakeAudioPlayerPort();
    const services = createServices({
      catalogOrigin: "https://catalog.test",
      catalogSha256: sha256,
      bundlesStore: new MomentStore(),
      audio: new AudioService({ createPort: () => audioPort }),
    });
    serve({ "catalog.json": CATALOG_TEXT, [POINTER_PATH]: INDEX_TEXT });
    renderRouter(withPlaceRoutes(services), { initialUrl: "/map" });
    fireEvent.press(await screen.findByTestId("nearby-card-offer-a1-place"));
    await screen.findByTestId("screen-Place detail");

    // The teaser launches and sounds; the port records the single play.
    audioPort.snapshotValue = { state: "playing", positionMs: 0, durationMs: 60000 };
    fireEvent.press(screen.getByTestId("place-moment-play-m-a1"));
    await waitFor(() => expect(screen.getByTestId("place-moment-live-m-a1")).toBeTruthy());

    // Back to Побач: the audio port records no stop across the navigation —
    // the app-level controller owns the launch, the surface does not.
    fireEvent.press(screen.getByTestId("btn-place-back"));
    expect(await screen.findByTestId("screen-Map")).toBeTruthy();
    expect(audioPort.commands).toEqual([`play 1:${MOMENT_PATH}`]);
  });

  // UX 01 (issue #347): the moment list scrolls — the fifth teaser renders
  // inside the detail's ScrollView instead of being cut by the fold.
  // Removing the ScrollView drops the scroll testID and fails this
  // (implementation-rules 1).
  test("the moment list scrolls: five teaser cards render inside the ScrollView (UX 01)", async () => {
    const { services } = placeServices(new FakeAudioPlayerPort(), 5);
    serve({ "catalog.json": CATALOG_TEXT, [POINTER_PATH]: INDEX_TEXT });
    renderRouter(withPlaceRoutes(services), { initialUrl: "/place/place-a1" });
    expect(await screen.findByTestId("scroll-place")).toBeTruthy();
    for (let n = 1; n <= 5; n += 1) {
      expect(screen.getByTestId(`place-moment-m-a${n}`)).toBeTruthy();
    }
    expect(screen.getByText("Тэйзер моманту s-a5")).toBeTruthy();
  });
});

// UX 07 (issue #353): the loading state shows the shared spinner next to the
// «Загрузка…» text — a never-resolving catalog fetch holds the detail in
// loading. Reverting the LoadingIndicator wiring in app/place/[id].tsx turns
// this red (implementation-rules 1).
describe("Place detail loading indicator (UX 07)", () => {
  test("the loading state shows the ActivityIndicator next to the text", async () => {
    jest.spyOn(global, "fetch").mockImplementation(() => new Promise(() => {}));
    renderRouter(
      withPlaceRoutes(createServices({ catalogOrigin: "https://catalog.test", catalogSha256: sha256 })),
      { initialUrl: "/place/place-a1" },
    );
    expect(await screen.findByTestId("loading-indicator")).toBeTruthy();
    expect(screen.getByTestId("place-loading")).toBeTruthy();
  });
});

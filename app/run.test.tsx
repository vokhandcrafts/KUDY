// G06.02 (issue #278) — the Run surface render tests over the real
// composition root: the map renders the engine's five marker states live
// (AC1), a marker tap opens the point preview and starts nothing — no play
// command, no session change (AC3), the POI point is visually its own kind
// (AC2), the words follow the walk's pinned locale in BE and EN (AC5) with
// screen-reader labels on the markers, and the surface without the run ports
// shows its honest unavailable state (AC4's composition-root rule).
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { act } from "@testing-library/react-native";

import Run from "./run/[id]";
import { createServices } from "../controllers/createServices";
import type { RunSessionPorts } from "../controllers/run/runSurfaceController";
import type { BundlesStore, Tier } from "../services/contentRepo/types";
import { FakeLocationOsPort } from "../services/location/fake-port";
import { layoutWith, makeRunSession } from "../test/render-helpers";

// The status label's text: a single-string Text child in this surface.
const textOf = (testId: string): string => {
  const children = screen.getByTestId(testId).props.children;
  return Array.isArray(children) ? children.join("") : String(children);
};

// The live step the panel tests share: three fixes inside stop-2's radius
// confirm the dwell (the pipeline smooths over the last three), the launch
// sounds and the marker flips to «гучыць».
async function soundStop2(args: { locationPort: FakeLocationOsPort; advance: (ms: number) => void }): Promise<void> {
  args.advance(10_000);
  const starts = args.locationPort.commands.filter((command) => command.startsWith("start "));
  const subscription = Number(starts[starts.length - 1].slice("start ".length));
  for (const offset of [0, 1_000, 2_000]) {
    act(() => {
      args.locationPort.emitFix(subscription, { lat: 54.3535, lng: 18.651, accuracy: 5, at: 10_000 + offset });
    });
    args.advance(10_000 + offset);
  }
  await waitFor(() => expect(textOf("run-status-stop-2")).toBe("Порт — гучыць"));
}

// The mounted surface the plain-session panel tests share: the composition
// root over the be fixture, the walk started, the map on screen.
async function mountedRunBe(): Promise<ReturnType<typeof makeRunSession>> {
  const env = makeRunSession();
  const services = createServices({ bundlesStore: memoryBundles(layerFiles("be")), run: { session: env.session } });
  renderRouter(withRunRoutes(services), { initialUrl: "/run/route-map" });
  await screen.findByTestId("run-map");
  return env;
}

const ROUTE_JSON = JSON.stringify({
  route_id: "route-map",
  version: "1",
  city_id: "gdansk",
  access: "paid",
  stops: [
    {
      id: "stop-1",
      position: 0,
      place_id: "place-1",
      access_tier: "base",
      story_base_id: "story-1",
      preview: { name: { be: "Мытня", en: "Customs" } },
    },
    {
      id: "stop-2",
      position: 1,
      place_id: "place-2",
      access_tier: "base",
      story_base_id: "story-2",
      preview: { name: { be: "Порт", en: "Port" } },
    },
    {
      id: "stop-3",
      position: 2,
      place_id: "place-3",
      access_tier: "extended",
      story_extended_id: "story-3",
      preview: { name: { be: "Вежа", en: "Tower" } },
    },
  ],
});
const PLACES_JSON = JSON.stringify([
  { id: "place-1", content_version: "cv-1", lat: 54.352, lng: 18.648, trigger_radius_m: 30, kind: "historic" },
  { id: "place-2", content_version: "cv-1", lat: 54.3535, lng: 18.651, trigger_radius_m: 30, kind: "historic" },
  { id: "place-3", content_version: "cv-1", lat: 54.3548, lng: 18.654, trigger_radius_m: 30, kind: "viewpoint" },
  { id: "place-9", content_version: "cv-1", lat: 54.3512, lng: 18.6498, trigger_radius_m: 10, kind: "cafe" },
]);
// The pinned layer's story facts (11 §3): each stop's base story with its
// own transcript, so the panel's split is provable — the card shows its
// stop's text, never the sounding story's.
const STOPS_JSON = JSON.stringify([
  { story_id: "story-1", place_id: "place-1", voice_id: "voice-1", tier: "base", duration_s: 60, text: "т", transcript: "Транскрыпт мытні", sources: ["с"] },
  { story_id: "story-2", place_id: "place-2", voice_id: "voice-1", tier: "base", duration_s: 60, text: "т", transcript: "Транскрыпт порта", sources: ["с"] },
]);
const layerFiles = (locale: string): Record<string, string> => ({
  [`bundles/route-map/1/${locale}/base/route.json`]: ROUTE_JSON,
  [`bundles/route-map/1/${locale}/base/places.json`]: PLACES_JSON,
  [`bundles/route-map/1/${locale}/base/stops.json`]: STOPS_JSON,
});

// The BundlesStore over an in-memory file map — the same seam the device
// adapter implements (09 §7 layout; listDir answers null for nothing here).
function memoryBundles(files: Record<string, string>): BundlesStore {
  return {
    listDir: async (rel) => {
      const prefix = rel.endsWith("/") ? rel : `${rel}/`;
      const names = new Set<string>();
      for (const key of Object.keys(files)) {
        if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split("/")[0]);
      }
      return names.size > 0 ? [...names] : null;
    },
    readFile: async (rel) => {
      const data = files[rel];
      return data === undefined
        ? { kind: "absent" }
        : { kind: "present", bytes: new TextEncoder().encode(data) };
    },
    statSize: async () => null,
  };
}

// The walk's ports come from the shared makeRunSession helper
// (test/render-helpers): real services over fake OS ports, the one
// LocationService instance the app owns. Session-store and recovery
// overrides pass through for the recovery/panel scenarios.

const withRunRoutes = (services: ReturnType<typeof createServices>) => ({
  _layout: layoutWith(services),
  "run/[id]": Run,
});

// The stateful session for the AC4 walk: the fake row records the durable
// deltas through the same checkpoint path the production row takes, and the
// recovery read returns it — the restart-recovery loop of 09 §9.1.
function runSessionTracked(): ReturnType<typeof makeRunSession> & { starts: () => number } {
  const row = {
    sessionId: "walk-render",
    routeId: "route-map",
    version: "1",
    locale: "be",
    tier: ["base" as Tier],
    state: "active" as const,
    startedAt: 0,
    finishedAt: null,
    lastStopId: null,
    heard: [] as string[],
    autoFired: [] as string[],
    playSeq: 0,
  };
  let starts = 0;
  const sessionStore: RunSessionPorts["sessionStore"] = {
    start: () => {
      starts += 1;
      return { ok: true as const };
    },
    checkpoint: (_sessionId, progress) => {
      if (progress.heard) row.heard = [...progress.heard];
      if (progress.autoFired) row.autoFired = [...progress.autoFired];
      if (progress.playSeq !== undefined) row.playSeq = progress.playSeq;
    },
    pause: () => {},
    resume: () => {},
    finish: () => {},
  };
  const recovery: RunSessionPorts["recovery"] = {
    read: async () =>
      starts === 0
        ? null
        : {
            row,
            routeId: "route-map",
            version: "1",
            layers: [
              {
                tier: "base" as Tier,
                status: "ready" as const,
                stops: [
                  { stopId: "stop-1", lat: 54.352, lng: 18.648, radius: 30, storyBaseId: "story-1" },
                  { stopId: "stop-2", lat: 54.3535, lng: 18.651, radius: 30, storyBaseId: "story-2" },
                ],
              },
            ],
          },
  };
  const base = makeRunSession({ sessionStore, recovery });
  return { ...base, starts: () => starts };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("run map surface", () => {
  test("AC1: the map renders the engine's marker states live", async () => {
    const { session, locationPort, audioPort, advance } = makeRunSession();
    const services = createServices({ bundlesStore: memoryBundles(layerFiles("be")), run: { session } });
    renderRouter(withRunRoutes(services), { initialUrl: "/run/route-map" });

    // The surface resolves the pinned package and starts the walk.
    await screen.findByTestId("run-map");
    expect(screen.getByTestId("run-marker-stop-1")).toBeTruthy();
    expect(textOf("run-status-stop-1")).toBe("Мытня — чакае");
    expect(textOf("run-status-stop-3")).toBe("Вежа — зачынена");
    // The POI point is its own kind, not a stop marker.
    expect(screen.getByTestId("run-poi-place-9")).toBeTruthy();
    expect(screen.getByText("cafe")).toBeTruthy();
    // The ODbL attribution is on the screen (11 §6 — the license duty).
    expect(screen.getByTestId("map-attribution")).toBeTruthy();

    // Live: the autoplay at stop-2 flips the marker to playing…
    await soundStop2({ locationPort, advance });
    // …and the focus loss keeps the launch but the marker follows the
    // audible state (ADR G01.02 §3.4): available, never played.
    act(() => {
      audioPort.focusLoss();
    });
    await waitFor(() => expect(textOf("run-status-stop-2")).toBe("Порт — даступна"));
  });

  test("AC3: a marker tap opens the point card on the panel and starts nothing", async () => {
    const { session, audioPort } = await mountedRunBe();
    expect(audioPort.commands).toEqual([]);

    // G06.03: the tap lands the panel on Half with the tapped card —
    // still no audio, no session change (the AC3 duty of both tasks).
    fireEvent.press(screen.getByTestId("run-marker-stop-1"));
    expect(screen.getByTestId("run-panel-half")).toBeTruthy();
    expect(screen.getByTestId("run-preview")).toBeTruthy();
    expect(screen.getByTestId("run-preview").children.length).toBeGreaterThan(0);
    expect(screen.getByText("Мытня")).toBeTruthy();
    expect(audioPort.commands).toEqual([]);
    expect(textOf("run-status-stop-1")).toBe("Мытня — чакае");

    fireEvent.press(screen.getByTestId("btn-panel-close"));
    expect(screen.queryByTestId("run-preview")).toBeNull();
    expect(screen.queryByTestId("run-panel-half")).toBeNull();
    expect(audioPort.commands).toEqual([]);
  });

  test("AC5: the words follow the walk's pinned locale, with screen-reader labels", async () => {
    const { session } = makeRunSession();
    const services = createServices({ bundlesStore: memoryBundles(layerFiles("en")), run: { session } });
    renderRouter(withRunRoutes(services), { initialUrl: "/run/route-map" });
    await screen.findByTestId("run-map");
    expect(textOf("run-status-stop-1")).toBe("Customs — pending");
    expect(textOf("run-status-stop-3")).toBe("Tower — locked");
    const label = screen.getByTestId("run-marker-stop-1").props.accessibilityLabel;
    expect(label).toBe("Customs, pending");
  });

  test("AC4: without the run ports the surface is honestly unavailable", async () => {
    const services = createServices({});
    renderRouter(withRunRoutes(services), { initialUrl: "/run/route-map" });
    expect(await screen.findByText("Сесія недаступная")).toBeTruthy();
    expect(screen.queryByTestId("run-map")).toBeNull();
  });

  test("G06.03 AC1: Back and the card's ✕ dismiss the panel identically", async () => {
    const { session, audioPort } = await mountedRunBe();

    fireEvent.press(screen.getByTestId("run-marker-stop-1"));
    expect(screen.getByTestId("run-panel-half")).toBeTruthy();
    fireEvent.press(screen.getByTestId("btn-run-back"));
    expect(screen.queryByTestId("run-panel-half")).toBeNull();
    expect(screen.getByTestId("run-panel-bar")).toBeTruthy();
    expect(audioPort.commands).toEqual([]);
    // Peeking credited nothing: the card's stop is still pending (AC5).
    expect(textOf("run-status-stop-1")).toBe("Мытня — чакае");

    // The ✕ walks the same ladder one card later — identical outcome.
    fireEvent.press(screen.getByTestId("run-marker-stop-1"));
    expect(screen.getByTestId("run-panel-half")).toBeTruthy();
    fireEvent.press(screen.getByTestId("btn-panel-close"));
    expect(screen.queryByTestId("run-panel-half")).toBeNull();
    expect(screen.getByTestId("run-panel-bar")).toBeTruthy();
    expect(audioPort.commands).toEqual([]);
  });

  test("G06.03 AC2: the transcript belongs to inspected, the bar and its fill to the audible story", async () => {
    const { session, locationPort, audioPort, advance } = await mountedRunBe();

    // The autoplay at stop-2 sounds; the player reports an honest offset.
    await soundStop2({ locationPort, advance });
    audioPort.snapshotValue = { state: "playing", positionMs: 1500, durationMs: 6000 };

    // The card opens stop-1 while stop-2 sounds: the row bridges them, and
    // the expanded card shows stop-1's own transcript — never stop-2's.
    fireEvent.press(screen.getByTestId("run-marker-stop-1"));
    expect(screen.getByTestId("run-panel-half")).toBeTruthy();
    expect(screen.getByTestId("run-nowplaying-row")).toBeTruthy();
    expect(screen.getByText("Зараз грае: Порт")).toBeTruthy();
    fireEvent.press(screen.getByTestId("btn-panel-read"));
    expect(screen.getByTestId("run-panel-full")).toBeTruthy();
    expect(screen.getByText("Транскрыпт мытні")).toBeTruthy();
    expect(screen.queryByText("Транскрыпт порта")).toBeNull();

    // Back at Peek the bar belongs to the sounding audio: stop-2's name and
    // its honest fill (1500/6000), not the inspected card's data.
    fireEvent.press(screen.getByTestId("btn-panel-close"));
    fireEvent.press(screen.getByTestId("btn-panel-close"));
    expect(screen.getByTestId("run-panel-bar")).toBeTruthy();
    expect(screen.getByText("Зараз грае: Порт")).toBeTruthy();
    const fillStyle = screen.getByTestId("run-bar-progress-fill").props.style;
    const width = Array.isArray(fillStyle)
      ? fillStyle.find((chunk) => chunk && typeof chunk === "object" && "width" in chunk)?.width
      : fillStyle?.width;
    expect(width).toBe("25%");
    // Peeking never credited stop-1 while another story sounded (AC5).
    expect(textOf("run-status-stop-1")).toBe("Мытня — чакае");
  });

  test("G06.03 AC4: leaving Run with the panel open keeps the durable session", async () => {
    const { session, locationPort, advance, starts } = runSessionTracked();
    const services = createServices({ bundlesStore: memoryBundles(layerFiles("be")), run: { session } });
    renderRouter(withRunRoutes(services), { initialUrl: "/run/route-map" });
    await screen.findByTestId("run-map");

    // The trigger at stop-2 spends auto_fired durably; the card is open.
    advance(10_000);
    const commands = locationPort.commands.filter((command) => command.startsWith("start "));
    const subscription = Number(commands[commands.length - 1].slice("start ".length));
    act(() => {
      locationPort.emitFix(subscription, { lat: 54.3535, lng: 18.651, accuracy: 5, at: 10_000 });
    });
    await waitFor(() => expect(textOf("run-status-stop-2")).toBe("Порт — гучыць"));
    fireEvent.press(screen.getByTestId("run-marker-stop-1"));
    expect(screen.getByTestId("run-panel-half")).toBeTruthy();

    // The person leaves Run and comes back — the composition root rebuilds
    // the surface, the live row is read (09 §9.1) and the walk continues:
    // no second Start, the spent trigger stays spent (check 17's durable
    // half of this panel criterion).
    renderRouter(withRunRoutes(services), { initialUrl: "/run/route-map" });
    await screen.findByTestId("run-map");
    expect(starts()).toBe(1);
    await waitFor(() => expect(textOf("run-status-stop-2")).toBe("Порт — даступна"));
    expect(screen.getByTestId("run-panel-bar")).toBeTruthy();
  });

  test("G06.03: the bar's play/pause drives only the audible launch", async () => {
    const { session, locationPort, audioPort, advance } = await mountedRunBe();

    await soundStop2({ locationPort, advance });

    // The bar's control is the launch's: Паўза stops the sound, Граць
    // resumes it through the controller's rebuilt token — and a card tap
    // in between commands nothing (the AC3 duty).
    fireEvent.press(screen.getByTestId("btn-bar-playpause"));
    await waitFor(() => expect(screen.queryByText("Паўза")).toBeNull());
    expect(screen.getByText("Граць")).toBeTruthy();
    fireEvent.press(screen.getByTestId("run-marker-stop-1"));
    expect(screen.getByTestId("run-panel-half")).toBeTruthy();
    expect(audioPort.commands.filter((command) => command === "pause" || command === "resume")).toEqual(["pause"]);
    fireEvent.press(screen.getByTestId("btn-panel-close"));
    fireEvent.press(screen.getByTestId("btn-bar-playpause"));
    await waitFor(() => expect(screen.queryByText("Граць")).toBeNull());
    expect(audioPort.commands.filter((command) => command === "pause" || command === "resume")).toEqual([
      "pause",
      "resume",
    ]);
  });
});

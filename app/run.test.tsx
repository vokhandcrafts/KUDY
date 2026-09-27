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
import type { BundlesStore, Tier } from "../services/contentRepo/types";
import type { RunSessionPorts } from "../controllers/run/runSurfaceController";
import { defaultEngineConfig } from "../core/engine/reducer";
import { LocationService } from "../services/location/service";
import { FakeLocationOsPort } from "../services/location/fake-port";
import { AudioService } from "../services/audio/service";
import { FakeAudioPlayerPort } from "../services/audio/fake-port";
import { createAccessPort } from "../services/download/access";
import { layoutWith } from "../test/render-helpers";

// The status label's text: a single-string Text child in this surface.
const textOf = (testId: string): string => {
  const children = screen.getByTestId(testId).props.children;
  return Array.isArray(children) ? children.join("") : String(children);
};

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
const layerFiles = (locale: string): Record<string, string> => ({
  [`bundles/route-map/1/${locale}/base/route.json`]: ROUTE_JSON,
  [`bundles/route-map/1/${locale}/base/places.json`]: PLACES_JSON,
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

// The walk's ports: real services over fake OS ports; the durable row is an
// in-memory fake — the node suite covers the real services/db path.
function runSession(): {
  session: RunSessionPorts;
  locationPort: FakeLocationOsPort;
  audioPort: FakeAudioPlayerPort;
  advance: (ms: number) => void;
} {
  const locationPort = new FakeLocationOsPort();
  const audioPort = new FakeAudioPlayerPort();
  const granted: Tier[] = ["base"];
  let now = 0;
  const session: RunSessionPorts = {
    location: new LocationService({
      port: locationPort,
      clock: { now: () => now, schedule: () => () => {} },
      permissions: { foreground: "fg", background: "bg" },
    }),
    audio: new AudioService({ createPort: () => audioPort }),
    clock: { now: () => now },
    engineConfig: defaultEngineConfig,
    pipelineConfig: { dwellMs: 0 },
    sessionStore: {
      start: () => ({ ok: true }),
      checkpoint: () => {},
      pause: () => {},
      resume: () => {},
      finish: () => {},
    },
    readiness: {
      evaluate: async () => ({ status: "ready", routeId: "route-map", version: "1", tier: "base", tierAvailable: granted }),
    },
    packageStops: { stopsOfLayer: async (tier) => (tier === "base" ? ["stop-1", "stop-2"] : tier === "extended" ? ["stop-3"] : []) },
    access: createAccessPort(),
    wakelock: { acquire: () => {}, release: () => {} },
    recovery: { read: async () => null },
    newSessionId: () => "walk-render",
    grantedTiers: () => granted,
  };
  return { session, locationPort, audioPort, advance: (ms: number) => (now = ms) };
}

const withRunRoutes = (services: ReturnType<typeof createServices>) => ({
  _layout: layoutWith(services),
  "run/[id]": Run,
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("run map surface", () => {
  test("AC1: the map renders the engine's marker states live", async () => {
    const { session, locationPort, audioPort, advance } = runSession();
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
    advance(10_000);
    const starts = locationPort.commands.filter((command) => command.startsWith("start "));
    const subscription = Number(starts[starts.length - 1].slice("start ".length));
    for (const offset of [0, 1_000, 2_000]) {
      act(() => {
        locationPort.emitFix(subscription, { lat: 54.3535, lng: 18.651, accuracy: 5, at: 10_000 + offset });
      });
      advance(10_000 + offset);
    }
    // The autoplay flips the marker to playing through the root's controller.
    await waitFor(() => expect(textOf("run-status-stop-2")).toBe("Порт — гучыць"));
    // …and the focus loss keeps the launch but the marker follows the
    // audible state (ADR G01.02 §3.4): available, never played.
    act(() => {
      audioPort.focusLoss();
    });
    await waitFor(() => expect(textOf("run-status-stop-2")).toBe("Порт — даступна"));
  });

  test("AC3: a marker tap opens the preview and starts nothing", async () => {
    const { session, audioPort } = runSession();
    const services = createServices({ bundlesStore: memoryBundles(layerFiles("be")), run: { session } });
    renderRouter(withRunRoutes(services), { initialUrl: "/run/route-map" });
    await screen.findByTestId("run-map");
    expect(audioPort.commands).toEqual([]);

    fireEvent.press(screen.getByTestId("run-marker-stop-1"));
    expect(screen.getByTestId("run-preview")).toBeTruthy();
    expect(screen.getByTestId("run-preview").children.length).toBeGreaterThan(0);
    expect(screen.getByText("Мытня")).toBeTruthy();
    // The tap never plays and never changes the session: no command reached
    // the audio service and the marker states are untouched.
    expect(audioPort.commands).toEqual([]);
    expect(textOf("run-status-stop-1")).toBe("Мытня — чакае");

    fireEvent.press(screen.getByTestId("btn-preview-close"));
    expect(screen.queryByTestId("run-preview")).toBeNull();
    expect(audioPort.commands).toEqual([]);
  });

  test("AC5: the words follow the walk's pinned locale, with screen-reader labels", async () => {
    const { session } = runSession();
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
});

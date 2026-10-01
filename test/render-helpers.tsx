// G06.01.b (issue #314) — shared render-test helpers: the fetch mock over
// fixture texts, the digest adapter and the services-provider layout. One
// copy for the app suites — sibling variants are jscpd clones
// (implementation-rules 3, 8).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { jest } from "@jest/globals";
import { Stack } from "expo-router";

import { defaultEngineConfig } from "../core/engine/reducer";
import { ServicesContext } from "../app/_layout";
import Explore from "../app/(tabs)/explore";
import NotFound from "../app/+not-found";
import Guides from "../app/city/[id]/guides";
import Map from "../app/map";
import My from "../app/(tabs)/my";
import PlaceDetail from "../app/place/[id]";
import RoutePreview from "../app/route/[id]";
import Run from "../app/run/[id]";
import { createServices } from "../controllers/createServices";
import type { Services } from "../controllers/createServices";
import type { RunSessionPorts } from "../controllers/run/runSurfaceController";
import type { Tier } from "../services/contentRepo/types";
import { AudioService } from "../services/audio/service";
import { FakeAudioPlayerPort } from "../services/audio/fake-port";
import { createAccessPort } from "../services/download/access";
import { FakeLocationOsPort } from "../services/location/fake-port";
import { LocationService } from "../services/location/service";

export const FIXTURES = join(dirname(__filename), "..", "fixtures", "discovery-contract");

export function fixtureText(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

// The real published catalog pair over the committed fixtures (the pointer's
// pin covers index-valid.json), served to suites that need a ready catalog
// — one copy; sibling maps are jscpd clones (implementation-rules 3, 8).
export const CATALOG_POINTER = "discovery/city-a/r-2026-09-14-1/index.json";
export const CATALOG_FIXTURES: Record<string, string> = {
  "catalog.json": fixtureText("catalog-with-discovery.json"),
  [CATALOG_POINTER]: fixtureText("index-valid.json"),
  "bundle/guide-route-a1/1/route.json": fixtureText("route-guide-route-a1.json"),
  "bundle/guide-route-b1/3/route.json": fixtureText("route-guide-route-b1.json"),
};

export const sha256 = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function serve(paths: Record<string, string>) {
  return jest.spyOn(global, "fetch").mockImplementation(async (input: unknown) => {
    const url = String(input);
    const hit = Object.entries(paths).find(([rel]) => url.endsWith(rel));
    if (!hit) return { ok: false, status: 404, text: async () => "no" } as unknown as Response;
    return { ok: true, status: 200, text: async () => hit[1] } as unknown as Response;
  });
}

export function layoutWith(services: Services) {
  // The test layout mirrors app/_layout.tsx: the provider around the Stack
  // navigator with the native header off (UX 02, issue #348 — expo-router
  // reads the routes from context, children are not rendered explicitly).
  return function TestLayout() {
    return (
      <ServicesContext.Provider value={services}>
        <Stack screenOptions={{ headerShown: false }} />
      </ServicesContext.Provider>
    );
  };
}

// The flattened style of a rendered element: the screens merge their frame
// styles into arrays (inset + base spacing), the guards read the effective
// value (UX 02, issue #348). Deep-flat: surfaces hand the shared pressable
// composed arrays and the wrapper appends its own layers (G06.10.d), so one
// level is not always enough — React Native paints the fully merged picture.
export function flatStyle(element: { props: { style?: unknown } }): Record<string, unknown> {
  const style = [element.props.style]
    .flat(Infinity)
    .filter((part) => part !== null && part !== undefined && typeof part === "object");
  return Object.assign({}, ...style) as Record<string, unknown>;
}

// UX 02 (issue #348) — the full route tree for the navigation-frame guards
// (back navigation, safe-area): the real screen components under the
// mirrored layout, the honest no-ports services. One copy for the frame
// suites — sibling route maps are jscpd clones (implementation-rules 3).
export function frameRoutes() {
  return {
    "_layout": layoutWith(createServices({})),
    "(tabs)/explore": Explore,
    "(tabs)/my": My,
    "city/[id]/guides": Guides,
    "route/[id]": RoutePreview,
    "place/[id]": PlaceDetail,
    "run/[id]": Run,
    "map": Map,
    "+not-found": NotFound,
  };
}

// The walk's ports (G06.02 render suites, reused by G07.01's Nearby suite):
// real services over fake OS ports; the durable row is an in-memory fake —
// the node suite covers the real services/db path. The same LocationService
// instance goes to createServices({ location }) — the one owner the app has
// (G07.01 criterion 4). The OS permission the service reads at construction
// — a test wanting a denied start passes it here, before the service exists.
// Session-store and recovery overrides carry the recovery/panel scenarios
// (G06.03); the defaults stay the in-memory happy path.
export function makeRunSession(options?: {
  permission?: 'granted' | 'denied' | 'undetermined';
  sessionStore?: RunSessionPorts['sessionStore'];
  recovery?: RunSessionPorts['recovery'];
  readiness?: RunSessionPorts['readiness'];
}): {
  session: RunSessionPorts;
  locationPort: FakeLocationOsPort;
  audioPort: FakeAudioPlayerPort;
  location: LocationService;
  advance: (ms: number) => void;
} {
  const locationPort = new FakeLocationOsPort();
  if (options?.permission) locationPort.permissionState = options.permission;
  const audioPort = new FakeAudioPlayerPort();
  const granted: Tier[] = ['base'];
  let now = 0;
  const location = new LocationService({
    port: locationPort,
    clock: { now: () => now, schedule: () => () => {} },
    permissions: { foreground: 'fg', background: 'bg' },
  });
  const session: RunSessionPorts = {
    location,
    audio: new AudioService({ createPort: () => audioPort }),
    clock: { now: () => now },
    engineConfig: defaultEngineConfig,
    pipelineConfig: { dwellMs: 0 },
    sessionStore:
      options?.sessionStore ?? {
        start: () => ({ ok: true }),
        // G06.04: the confirmed switch needs a live row to switch away from
        // — the plain render world honestly refuses here.
        startSwitch: () => ({ ok: false as const, reason: 'no-live-session' as const }),
        checkpoint: () => {},
        pause: () => {},
        resume: () => {},
        finish: () => {},
      },
    readiness:
      options?.readiness ?? {
        evaluate: async () => ({ status: 'ready', routeId: 'route-map', version: '1', tier: 'base', tierAvailable: granted }),
      },
    // G06.04 made the port route-aware: the route id comes first, the tier
    // second — the helper serves the render fixture's own route.
    packageStops: { stopsOfLayer: async (_routeId, tier) => (tier === 'base' ? ['stop-1', 'stop-2'] : tier === 'extended' ? ['stop-3'] : []) },
    access: createAccessPort(),
    wakelock: { acquire: () => {}, release: () => {} },
    recovery: options?.recovery ?? { read: async () => null },
    newSessionId: () => 'walk-render',
    grantedTiers: () => granted,
  };
  return { session, locationPort, audioPort, location, advance: (ms: number) => (now = ms) };
}

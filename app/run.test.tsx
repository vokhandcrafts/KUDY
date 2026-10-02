// G06.02 (issue #278) — the Run surface render tests over the real
// composition root: the map renders the engine's five marker states live
// (AC1), a marker tap opens the point preview and starts nothing — no play
// command, no session change (AC3), the POI point is visually its own kind
// (AC2), the words follow the walk's pinned locale in BE and EN (AC5) with
// screen-reader labels on the markers, and the surface without the run ports
// shows its honest unavailable state (AC4's composition-root rule).
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { fireEvent, renderRouter, screen, waitFor, within } from "expo-router/testing-library";
import { act } from "@testing-library/react-native";

import { Modal } from "react-native";

import Run from "./run/[id]";
import { createServices } from "../controllers/createServices";
import type { RunSessionPorts } from "../controllers/run/runSurfaceController";
import type { BundlesStore, Readiness, Tier } from "../services/contentRepo/types";
import { FakeLocationOsPort } from "../services/location/fake-port";
import { flatStyle, layoutWith, makeRunSession } from "../test/render-helpers";
import { tokens } from "../components/design-tokens";
import * as Reanimated from "react-native-reanimated";

// G06.10.f (issue #406): the reduce-motion seam — the controllable stub of
// the jest stand-in (test/reanimated-mock.js), read live by the component.
const reducedMotionStub = Reanimated.useReducedMotion as unknown as {
  mockReturnValue: (value: boolean) => void;
};

// UX 02 (issue #348): the frame's insets are pinned to the same fake the
// safe-area guard uses — the panel's bottom padding assertions below read
// spaceM + 34 against it.
jest.mock("react-native-safe-area-context", () => ({
  ...(jest.requireActual("react-native-safe-area-context") as Record<string, unknown>),
  useSafeAreaInsets: () => ({ top: 50, bottom: 34, left: 0, right: 0 }),
}));

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

// The re-entry scenarios' shared mount (G06.04 extracted it): the
// composition root over the be fixture, the walk started, the map on
// screen, stop-2 sounding.
async function mountedRunSoundingStop2(
  world: Pick<ReturnType<typeof makeRunSession>, "session" | "locationPort" | "advance">,
): Promise<ReturnType<typeof createServices>> {
  const services = createServices({ bundlesStore: memoryBundles(layerFiles("be")), run: { session: world.session } });
  renderRouter(withRunRoutes(services), { initialUrl: "/run/route-map" });
  await screen.findByTestId("run-map");
  await soundStop2({ locationPort: world.locationPort, advance: world.advance });
  return services;
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
      story_extended_id: "story-1x",
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
  { id: "place-10", content_version: "cv-1", lat: 54.3515, lng: 18.6502, trigger_radius_m: 10, kind: "sight" },
]);
// The pinned layer's story facts (11 §3): each stop's base story with its
// own transcript, so the panel's split is provable — the card shows its
// stop's text, never the sounding story's.
const STOPS_JSON = JSON.stringify([
  { story_id: "story-1", place_id: "place-1", voice_id: "voice-1", tier: "base", duration_s: 60, text: "т", transcript: "Транскрыпт мытні", sources: ["с"] },
  { story_id: "story-2", place_id: "place-2", voice_id: "voice-1", tier: "base", duration_s: 60, text: "т", transcript: "Транскрыпт порта", sources: ["с"] },
]);
// G06.05 (issue #280, AC3): the extended layer's own story facts — the
// transcript switch's second source (read only when the pin carries the
// tier).
const EXTENDED_STOPS_JSON = JSON.stringify([
  { story_id: "story-1x", place_id: "place-1", voice_id: "voice-1", tier: "extended", duration_s: 90, text: "т", transcript: "Транскрыпт дадатковай гісторыі", sources: ["с"] },
]);
const layerFiles = (locale: string): Record<string, string> => ({
  [`bundles/route-map/1/${locale}/base/route.json`]: ROUTE_JSON,
  [`bundles/route-map/1/${locale}/base/places.json`]: PLACES_JSON,
  [`bundles/route-map/1/${locale}/base/stops.json`]: STOPS_JSON,
  [`bundles/route-map/1/${locale}/extended/stops.json`]: EXTENDED_STOPS_JSON,
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
    // The tracked render world exercises no switch (G06.04): the refusal
    // keeps the port honest where the scenario never goes.
    startSwitch: () => ({ ok: false as const, reason: "no-live-session" as const }),
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
    // The POI point is its own kind, not a stop marker. UX 05 (issue
    // #351): the label goes through the run strings' kind dictionary —
    // «sight» renders its Belarusian word, a kind without an entry renders
    // no label and the raw value never shows. Reverting the screen to
    // `poi.kind` surfaces the raw "cafe" and fails the null query.
    expect(screen.getByTestId("run-poi-place-9")).toBeTruthy();
    expect(screen.getByTestId("run-poi-place-10")).toBeTruthy();
    expect(screen.getByText("Славутасць")).toBeTruthy();
    expect(screen.queryByText(/cafe/)).toBeNull();
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

  // G08.05 (AC5, 11 §16.4): the locked card states the honest next step —
  // available after purchase — and nothing else: no story text, no
  // transcript, no commerce action (NAV5/N7; the extended story's text is
  // not in the free package at all, so there is nothing to leak).
  test("G08.05 AC5: the locked card keeps the honest available-after-purchase state", async () => {
    await mountedRunBe();
    fireEvent.press(screen.getByTestId("run-marker-stop-3"));
    expect(screen.getByTestId("run-preview")).toBeTruthy();
    expect(screen.getByTestId("run-locked-hint")).toBeTruthy();
    expect(screen.getByText("Даступна пасля куплі")).toBeTruthy();
    // No commerce on the Run surface (C26) and no play for the locked point.
    expect(screen.queryByTestId("upgrade-offer")).toBeNull();
    expect(screen.queryByTestId("btn-card-play")).toBeNull();
  });

  // G08.05 (AC1, `11` C26): «у Run яна не паказваецца ў Peek або падчас
  // аўдыё» — the offer's only home is the preview; while the walk's audio
  // sounds, no commerce renders anywhere on the surface, panel open or not.
  test("G08.05 AC1/C26: no quiet offer anywhere under sounding audio", async () => {
    const world = makeRunSession();
    await mountedRunSoundingStop2(world);
    expect(screen.queryAllByTestId("upgrade-offer")).toEqual([]);
    fireEvent.press(screen.getByTestId("run-marker-stop-3"));
    expect(screen.getByTestId("run-panel-half")).toBeTruthy();
    expect(screen.queryAllByTestId("upgrade-offer")).toEqual([]);
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

  // UX 02 (issue #348): the surface starts at status 'loading' and resolves
  // through the readiness port — a pending readiness holds the state, and
  // the frame's back must be there. Reverting the loading branch's
  // BackButton in app/run/[id].tsx turns this red (implementation-rules 1).
  test("UX 02: the loading state keeps the back element (AC2)", async () => {
    const pending = new Promise<Readiness>(() => {});
    const { session } = makeRunSession({ readiness: { evaluate: () => pending } });
    const services = createServices({ bundlesStore: memoryBundles(layerFiles("be")), run: { session } });
    renderRouter(withRunRoutes(services), { initialUrl: "/run/route-map" });
    // The loading branch itself, not the unavailable one: the honest
    // «Загрузка…» wording is on the screen while readiness stays pending.
    expect(await screen.findByText("Загрузка…")).toBeTruthy();
    // UX 07 (issue #353): the loading row carries the shared spinner —
    // reverting the LoadingIndicator wiring turns this red too.
    expect(await screen.findByTestId("loading-indicator")).toBeTruthy();
    expect(await screen.findByTestId("btn-run-back")).toBeTruthy();
    expect(within(screen.getByTestId("btn-run-back")).getByText("Назад")).toBeTruthy();
  });

  test("G06.03 AC1: Back and the card's ✕ dismiss the panel identically", async () => {
    const { session, audioPort } = await mountedRunBe();

    fireEvent.press(screen.getByTestId("run-marker-stop-1"));
    expect(screen.getByTestId("run-panel-half")).toBeTruthy();
    // UX 02 (issue #348): the sheet's bottom padding keeps its content above
    // the home-indicator area — the pinned bottom inset (34) on the base
    // spacing (AC4).
    expect(flatStyle(screen.getByTestId("run-panel-half")).paddingBottom).toBe(tokens.spaceM + 34);
    // UX 02 (issue #348): the back's label lives in a <Text> — the #344 guard
    // (within().getByText() reaches only <Text> hosts, a reverted bare string
    // fails here).
    expect(within(screen.getByTestId("btn-run-back")).getByText("Назад")).toBeTruthy();
    fireEvent.press(screen.getByTestId("btn-run-back"));
    expect(screen.queryByTestId("run-panel-half")).toBeNull();
    expect(screen.getByTestId("run-panel-bar")).toBeTruthy();
    // The bar rides the same bottom inset (AC4).
    expect(flatStyle(screen.getByTestId("run-panel-bar")).paddingBottom).toBe(tokens.spaceM + 34);
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
    const world = runSessionTracked();
    const services = await mountedRunSoundingStop2(world);
    const { starts, locationPort, advance } = world;
    fireEvent.press(screen.getByTestId("run-marker-stop-1"));
    expect(screen.getByTestId("run-panel-half")).toBeTruthy();

    // The person leaves Run and comes back — the composition root reuses the
    // surface (G06.04 NAV7 cache), the walk continues: no second Start, the
    // spent trigger stays spent (check 17's durable half of this panel
    // criterion), and the panel is where it was left — Half, the card open.
    renderRouter(withRunRoutes(services), { initialUrl: "/run/route-map" });
    await screen.findByTestId("run-map");
    expect(starts()).toBe(1);
    // The live in-memory walk, not a row restore: the story is still sounding
    // exactly as it was left (the audio service was never touched).
    await waitFor(() => expect(textOf("run-status-stop-2")).toBe("Порт — гучыць"));
    expect(screen.getByTestId("run-panel-half")).toBeTruthy();
  });

  test("G06.04 NAV7: re-entering Run keeps the panel position and never stops the sound", async () => {
    const world = makeRunSession();
    const services = await mountedRunSoundingStop2(world);
    const { audioPort } = world;
    fireEvent.press(screen.getByTestId("run-marker-stop-1"));
    expect(screen.getByTestId("run-panel-half")).toBeTruthy();

    // Leave and return through «Прагулка»'s target: the same surface — the
    // panel is Half again, and the sounding story was never stopped (NAV7:
    // navigating out of Run does not touch the audio).
    const stopsBefore = audioPort.commands.filter((command) => command === "stop").length;
    renderRouter(withRunRoutes(services), { initialUrl: "/run/route-map" });
    await screen.findByTestId("run-map");
    expect(screen.getByTestId("run-panel-half")).toBeTruthy();
    expect(audioPort.commands.filter((command) => command === "stop")).toHaveLength(stopsBefore);
  });

  test("G06.04: the session menu pauses the walk and finishes it after one story (11 §4.2/§4.3)", async () => {
    const { session, locationPort, audioPort, advance } = makeRunSession();
    const services = createServices({ bundlesStore: memoryBundles(layerFiles("be")), run: { session } });
    renderRouter(withRunRoutes(services), { initialUrl: "/run/route-map" });
    await screen.findByTestId("run-map");

    // The whole-walk pause is its own action, not the audio's: the banner
    // appears, the pause action gives way to the banner's Resume, and the
    // finish stays reachable from Paused.
    fireEvent.press(screen.getByTestId("btn-run-pause"));
    await waitFor(() => expect(screen.getByTestId("run-paused")).toBeTruthy());
    expect(screen.queryByTestId("btn-run-pause")).toBeNull();
    expect(screen.getByTestId("btn-run-end")).toBeTruthy();
    fireEvent.press(screen.getByTestId("btn-run-resume"));
    await waitFor(() => expect(screen.queryByTestId("run-paused")).toBeNull());

    // One story heard (stop-2's automatic launch), then the finish — legal
    // after one story, no route completion required (11 §4.3). UX 06 (issue
    // #352): the destructive finish asks first, the confirmation ends it.
    await soundStop2({ locationPort, advance });
    act(() => {
      audioPort.finish(1);
    });
    await waitFor(() => expect(textOf("run-status-stop-2")).toBe("Порт — праслухана"));
    fireEvent.press(screen.getByTestId("btn-run-end"));
    fireEvent.press(screen.getByTestId("btn-end-confirm-accept"));
    expect(await screen.findByTestId("run-ended")).toBeTruthy();
    // The finished walk has no session actions left — Finished is not a
    // live walk anymore (11 §3.3).
    expect(screen.queryByTestId("run-session-actions")).toBeNull();
  });

  // The confirmed-switch world (G06.04): the live row belongs to ANOTHER
  // route, so this route's surface recovers nothing; the store port mirrors
  // the one-unfinished rule — a plain Start refuses, the confirmed switch
  // finishes the other row and starts this one.
  function switchWorld(): ReturnType<typeof makeRunSession> & { switched: () => string | null } {
    const otherRow = {
      sessionId: "walk-other",
      routeId: "route-other",
      version: "1",
      locale: "be",
      tier: ["base" as Tier],
      state: "active" as "active" | "paused" | "finished",
      startedAt: 0,
      finishedAt: null as number | null,
      lastStopId: null,
      heard: [] as string[],
      autoFired: [] as string[],
      playSeq: 0,
    };
    let switchedTo: string | null = null;
    const sessionStore: RunSessionPorts["sessionStore"] = {
      start: () =>
        otherRow.state === "active" || otherRow.state === "paused"
          ? { ok: false as const, reason: "live-session-exists" as const }
          : { ok: true as const },
      startSwitch: (_input, meta) => {
        if (otherRow.state !== "active" && otherRow.state !== "paused") {
          return { ok: false as const, reason: "no-live-session" as const };
        }
        otherRow.state = "finished";
        otherRow.finishedAt = meta.finishedAt;
        switchedTo = otherRow.sessionId;
        return { ok: true as const, finishedSessionId: otherRow.sessionId };
      },
      checkpoint: () => {},
      pause: () => {},
      resume: () => {},
      finish: () => {},
    };
    const base = makeRunSession({ sessionStore, recovery: { read: async () => null } });
    return { ...base, switched: () => switchedTo };
  }

  test("G06.04 NAV8: the confirmed «Завяршыць і пачаць» starts through the switch, not a refusal", async () => {
    const { session, switched } = switchWorld();
    const services = createServices({ bundlesStore: memoryBundles(layerFiles("be")), run: { session } });
    renderRouter(withRunRoutes(services), { initialUrl: "/run/route-map?confirmedSwitch=1" });
    // The surface started: without the flag the live other-route row would
    // refuse this Start (one-unfinished-session rule) and the screen would
    // render its unavailable reason instead of the map.
    await screen.findByTestId("run-map");
    expect(switched()).toBe("walk-other");
  });

  test("G06.04 NAV8: without the flag the same surface refuses — the quiet switch is forbidden", async () => {
    const { session } = switchWorld();
    const services = createServices({ bundlesStore: memoryBundles(layerFiles("be")), run: { session } });
    renderRouter(withRunRoutes(services), { initialUrl: "/run/route-map" });
    expect(await screen.findByText("Сесія недаступная")).toBeTruthy();
    expect(screen.getByTestId("run-unavailable-reason").props.children).toBe("Ужо ёсць жывая прагулка.");
  });

  // UX 06 (issue #352) AC3: the destructive finish asks first; the decline
  // (and the system Back, the shell's onRequestClose) leaves the session
  // active and unchanged, the confirmation finishes as before. Reverting
  // btn-run-end to a direct run.end() fails the first half — the dialog
  // never appears and the walk ends on the press (implementation-rules 1).
  test("UX 06 AC3: the finish asks for confirmation; the decline keeps the session", async () => {
    const { session } = await mountedRunBe();

    // The press opens the confirmation modal, the walk stays live.
    fireEvent.press(screen.getByTestId("btn-run-end"));
    expect(screen.getByTestId("end-confirm-dialog")).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(Modal)).toHaveLength(1);
    expect(screen.queryByTestId("run-ended")).toBeNull();
    expect(screen.getByTestId("run-session-actions")).toBeTruthy();

    // The decline closes the dialog and changes nothing.
    fireEvent.press(screen.getByTestId("btn-end-confirm-cancel"));
    expect(screen.queryByTestId("end-confirm-dialog")).toBeNull();
    expect(screen.queryByTestId("run-ended")).toBeNull();
    expect(screen.getByTestId("run-session-actions")).toBeTruthy();

    // The system Back runs the same decline path through the shell's
    // onRequestClose — the session is still unchanged.
    fireEvent.press(screen.getByTestId("btn-run-end"));
    act(() => {
      screen.UNSAFE_queryByType(Modal)?.props.onRequestClose();
    });
    expect(screen.queryByTestId("end-confirm-dialog")).toBeNull();
    expect(screen.queryByTestId("run-ended")).toBeNull();

    // The confirmation finishes the walk as before — the ended screen, no
    // session actions left.
    fireEvent.press(screen.getByTestId("btn-run-end"));
    fireEvent.press(screen.getByTestId("btn-end-confirm-accept"));
    expect(await screen.findByTestId("run-ended")).toBeTruthy();
    expect(screen.queryByTestId("run-session-actions")).toBeNull();
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

  // UX 01 (issue #347): the Full panel's content scrolls — a long transcript
  // renders inside the panel's ScrollView; the family map stays a fixed flex
  // child, never a scroll surface (AC5). Removing the ScrollView drops the
  // scroll testID and fails this (implementation-rules 1).
  test("UX 01: the full panel's transcript scrolls; the map stays a fixed flex child", async () => {
    const longTranscript = "Доўгая гісторыя кропкі. ".repeat(400);
    const files = {
      ...layerFiles("be"),
      "bundles/route-map/1/be/base/stops.json": JSON.stringify([
        {
          story_id: "story-1",
          place_id: "place-1",
          voice_id: "voice-1",
          tier: "base",
          duration_s: 60,
          text: "т",
          transcript: longTranscript,
          sources: ["с"],
        },
        {
          story_id: "story-2",
          place_id: "place-2",
          voice_id: "voice-1",
          tier: "base",
          duration_s: 60,
          text: "т",
          transcript: "Транскрыпт порта",
          sources: ["с"],
        },
      ]),
    };
    const { session } = makeRunSession();
    const services = createServices({ bundlesStore: memoryBundles(files), run: { session } });
    renderRouter(withRunRoutes(services), { initialUrl: "/run/route-map" });
    await screen.findByTestId("run-map");
    fireEvent.press(screen.getByTestId("run-marker-stop-1"));
    fireEvent.press(screen.getByTestId("btn-panel-read"));
    expect(screen.getByTestId("run-panel-full")).toBeTruthy();
    expect(screen.getByTestId("scroll-run-panel")).toBeTruthy();
    expect(screen.getByText(longTranscript)).toBeTruthy();
    // The map's flex layout is untouched: it fills the screen above the
    // panel, it is not a scroll surface.
    expect(screen.getByTestId("run-map").props.style).toEqual(expect.objectContaining({ flex: 1 }));
  });

  // UX 04 (issue #350): the ODbL attribution is a real link that rides the
  // peek bar — the bar's absolute positioning can no longer cover the
  // screen's bottom flow (AC3), and it announces itself as a link (AC4).
  // Reverting the attribution to the in-flow Text under the bar fails the
  // within(bar) lookup (implementation-rules 1).
  test("UX 04: the attribution is a link inside the peek bar, never under it (AC3/AC4)", async () => {
    await mountedRunBe();
    expect(within(screen.getByTestId("run-panel-bar")).getByTestId("map-attribution")).toBeTruthy();
    expect(screen.getByTestId("map-attribution").props.accessibilityRole).toBe("link");
    // One attribution on the screen — the in-flow copy yields to the bar's.
    expect(screen.getAllByTestId("map-attribution")).toHaveLength(1);
  });

  // UX 04 (issue #350, AC4/AC5): the marker block keeps the 44dp touch-target
  // floor and the marker/POI labels stay at the readable 12dp minimum.
  test("UX 04: the marker's touch target is ≥44dp and the map labels are ≥12dp (AC4/AC5)", async () => {
    await mountedRunBe();
    const marker = flatStyle(screen.getByTestId("run-marker-stop-1"));
    expect(marker.width).toBe(120);
    expect(marker.minHeight).toBeGreaterThanOrEqual(44);
    expect(flatStyle(screen.getByTestId("run-status-stop-1")).fontSize).toBeGreaterThanOrEqual(12);
    // UX 05 (issue #351): the POI label is the localized kind word, not the
    // raw id — the 12dp floor applies to it the same way.
    expect(flatStyle(screen.getByText("Славутасць")).fontSize).toBeGreaterThanOrEqual(12);
  });

  // UX 04 (issue #350, AC2): the canon strip — 6px accent on line with the
  // muted 1px edge that keeps the track identifiable on the card.
  test("UX 04: the progress strip keeps its canon height and a ≥3:1 edge on the card (AC2)", async () => {
    const { locationPort, advance } = await mountedRunBe();
    await soundStop2({ locationPort, advance });
    const track = flatStyle(screen.getByTestId("run-bar-progress"));
    expect(track.height).toBe(6);
    expect(track.borderWidth).toBe(1);
    expect(track.borderColor).toBe(tokens.colorMuted);
  });
});

// G06.05 (issue #280) — accessibility and honest failure states: the denied
// GPS banner with its manual exit (11 §7), the failed-play announcement, the
// restored walk's note with its lost tier, and the story-layer transcript
// switch. Every assertion here is the reverted-line check of its fix
// (implementation-rules 1): removing the banner, the label or the switch
// turns its test red.
describe("G06.05 accessibility and honest failures (issue #280)", () => {
  // A world whose recovery read always answers with the live row — the
  // restart-recovery path (09 §9.1), the only one that can pin the extended
  // tier. The base layer's stop-1 carries the extended story id.
  function restoredWorld(tier: Tier[], extendedLayerStatus: "ready" | "incomplete") {
    const row = {
      sessionId: "walk-restored",
      routeId: "route-map",
      version: "1",
      locale: "be",
      tier,
      state: "active" as const,
      startedAt: 0,
      finishedAt: null,
      lastStopId: null,
      heard: ["story-2"],
      autoFired: [],
      playSeq: 0,
    };
    const recovery: RunSessionPorts["recovery"] = {
      read: async () => ({
        row,
        routeId: "route-map",
        version: "1",
        layers: [
          {
            tier: "base" as Tier,
            status: "ready" as const,
            stops: [
              { stopId: "stop-1", lat: 54.352, lng: 18.648, radius: 30, storyBaseId: "story-1", storyExtendedId: "story-1x" },
              { stopId: "stop-2", lat: 54.3535, lng: 18.651, radius: 30, storyBaseId: "story-2" },
            ],
          },
          { tier: "extended" as Tier, status: extendedLayerStatus, stops: [] },
        ],
      }),
    };
    return makeRunSession({ recovery });
  }

  test("AC4: a denied GPS renders the contract banner; manual play still launches the audio", async () => {
    const env = makeRunSession({ permission: "denied" });
    const services = createServices({ bundlesStore: memoryBundles(layerFiles("be")), run: { session: env.session } });
    renderRouter(withRunRoutes(services), { initialUrl: "/run/route-map" });
    // The named line of 11 §7 — the wording is the contract's own, the hint
    // names the manual path (the manual mode is a full path, not an
    // emergency).
    await screen.findByTestId("run-gps-denied");
    expect(screen.getByText("Аўтаматычныя гісторыі не працуюць — я не бачу вашай пазіцыі")).toBeTruthy();
    expect(screen.getByText("Кожная гісторыя запускаецца рукамі з карткі кропкі")).toBeTruthy();
    // The manual exit end-to-end: the card's play button launches the story
    // through the engine's UserSelectedStory path — no GPS involved.
    fireEvent.press(screen.getByTestId("run-marker-stop-1"));
    await screen.findByTestId("run-panel-half");
    expect(screen.getByTestId("btn-card-play").props.accessibilityRole).toBe("button");
    fireEvent.press(screen.getByTestId("btn-card-play"));
    await waitFor(() =>
      expect(env.audioPort.commands.some((command) => command.startsWith("play "))).toBe(true),
    );
  });

  test("AC5: a failed story play is announced — the suspended banner names the manual path", async () => {
    const world = makeRunSession();
    await mountedRunSoundingStop2(world);
    // The sounding source fails: the engine suspends the automation, and the
    // surface announces it instead of silently reverting the marker.
    const playCommand = world.audioPort.commands.find((command) => command.startsWith("play "));
    const key = Number(playCommand!.slice("play ".length).split(":")[0]);
    act(() => {
      world.audioPort.fail(key, "decode-failed");
    });
    await screen.findByTestId("run-autoplay-suspended");
    expect(screen.getByText("Аўтаматычныя гісторыі прыпыненыя")).toBeTruthy();
    expect(screen.getByText("Кожная гісторыя запускаецца рукамі з карткі кропкі")).toBeTruthy();
    // The label set stays complete: the same surface still reads in EN (AC1).
    expect(screen.getByTestId("btn-run-end").props.accessibilityRole).toBe("button");
  });

  test("AC4: the restored walk announces itself and names the lost tier", async () => {
    const env = restoredWorld(["base" as Tier, "extended" as Tier], "incomplete");
    const services = createServices({ bundlesStore: memoryBundles(layerFiles("be")), run: { session: env.session } });
    renderRouter(withRunRoutes(services), { initialUrl: "/run/route-map" });
    await screen.findByTestId("run-restored");
    expect(screen.getByText("Прагулка працягнута са захаванай сесіі")).toBeTruthy();
    // The §3.7 report: the extended layer did not verify — the note says so.
    expect(screen.getByText("Дадатковы ярус недаступны ў адноўленай сесіі")).toBeTruthy();
  });

  test("AC3/AC4: the card switches story layers, shows each transcript and plays the extended story", async () => {
    const env = restoredWorld(["base" as Tier, "extended" as Tier], "ready");
    const services = createServices({ bundlesStore: memoryBundles(layerFiles("be")), run: { session: env.session } });
    renderRouter(withRunRoutes(services), { initialUrl: "/run/route-map" });
    await screen.findByTestId("run-map");
    fireEvent.press(screen.getByTestId("run-marker-stop-1"));
    await screen.findByTestId("run-panel-half");
    fireEvent.press(screen.getByTestId("btn-panel-read"));
    await screen.findByTestId("run-panel-full");
    // The base story's transcript first; the switch names both layers.
    expect(screen.getByText("Транскрыпт мытні")).toBeTruthy();
    expect(screen.getByTestId("btn-story-base").props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId("btn-story-extended").props.accessibilityState).toEqual({ selected: false });
    fireEvent.press(screen.getByTestId("btn-story-extended"));
    await waitFor(() => expect(screen.getByText("Транскрыпт дадатковай гісторыі")).toBeTruthy());
    expect(screen.getByTestId("btn-story-extended").props.accessibilityState).toEqual({ selected: true });
    // The extended story is hand-playable too — its tier is in the pin.
    fireEvent.press(screen.getByTestId("btn-card-play"));
    await waitFor(() =>
      expect(env.audioPort.commands.some((command) => command.startsWith("play "))).toBe(true),
    );
  });
});

// G06.10.e (issue #405): the Run panel is a canon-forbidden grain place —
// the painted tree never carries the grain layer (the import walk in
// test/design-tokens.test.mjs is the source-side guard). Granting Run the
// grain turns this red.
describe("Run paper grain (G06.10.e)", () => {
  test("the run surface never mounts the grain layer", async () => {
    await mountedRunBe();
    // Neither the a11y tree (default queries) nor the render tree carries
    // the layer on Run.
    expect(screen.queryByTestId("paper-grain")).toBeNull();
    expect(screen.queryByTestId("paper-grain", { includeHiddenElements: true })).toBeNull();
  });
});

// G06.10.f (issue #406) — the living progress: the bar's fill eases to each
// new value on the reanimated base, and with the system reduce-motion
// setting on (the stand-in's stub here, the base's system-aware mode on
// device) it lands instantly. The drive is the G06.03 one — an honest
// snapshot from the fake port — with the bar kept mounted through a pause
// press, the re-render the effect needs (a card tap would unmount the bar
// and the remount would land at its own value, by design).

// One progress change, landed on the mounted bar: the fake port's snapshot
// is rewritten to the honest offset (stop-2's 6s source) and a bar press
// re-renders the strip — the press flips the play/pause label, which is the
// wait the re-render is anchored to.
async function landProgress(
  audioPort: ReturnType<typeof makeRunSession>["audioPort"],
  positionMs: number,
  barLabel: string,
): Promise<void> {
  audioPort.snapshotValue = { state: "playing", positionMs, durationMs: 6000 };
  fireEvent.press(screen.getByTestId("btn-bar-playpause"));
  await waitFor(() => expect(within(screen.getByTestId("btn-bar-playpause")).getByText(barLabel)).toBeTruthy());
}

describe("G06.10.f live walk progress (issue #406)", () => {
  afterEach(() => {
    reducedMotionStub.mockReturnValue(false);
    jest.restoreAllMocks();
  });

  // AC1: a change eases — withTiming carries the shared pace; reverting the
  // fill to the static percent-width style turns this red (the Proof).
  test("AC1: the bar's fill eases to each new value — withTiming carries the pace", async () => {
    const { locationPort, audioPort, advance } = await mountedRunBe();
    const spy = jest.spyOn(Reanimated, "withTiming");
    await soundStop2({ locationPort, advance });
    spy.mockClear();

    await landProgress(audioPort, 1500, "Граць");
    expect(spy).toHaveBeenCalledWith(25, expect.objectContaining({ duration: 400 }));

    await landProgress(audioPort, 4500, "Паўза");
    expect(spy).toHaveBeenCalledWith(75, expect.objectContaining({ duration: 400 }));
    // The stand-in lands animations instantly, so the final-state assertion
    // reads the eased-to value right off the mounted strip.
    expect(flatStyle(screen.getByTestId("run-bar-progress-fill")).width).toBe("75%");
  });

  // AC2: with reduce-motion on, the change applies the final width
  // immediately — no transition values anywhere; stripping the
  // reduce-motion branch turns this red (the Proof).
  test("AC2: with reduce-motion on, the change lands instantly — no transition values", async () => {
    reducedMotionStub.mockReturnValue(true);
    const { locationPort, audioPort, advance } = await mountedRunBe();
    const spy = jest.spyOn(Reanimated, "withTiming");
    await soundStop2({ locationPort, advance });
    spy.mockClear();

    await landProgress(audioPort, 1500, "Граць");
    expect(flatStyle(screen.getByTestId("run-bar-progress-fill")).width).toBe("25%");
    expect(spy).not.toHaveBeenCalled();
  });
});

// Issue #524 — the unavailable and not-ready words follow the UI-locale
// choice (the #305 store): without a ready session the fixed "be" fallback
// kept «Сесія недаступная» on screen after choosing Українська or English.
// The real store (createServices' uiLocale) drives every case; reverting the
// `?? locale` fallbacks in app/run/[id].tsx turns the unavailable and
// loading cases red while the pinned-locale case stays green
// (implementation-rules 1).
describe("Run unavailable words follow the UI-locale choice (issue #524)", () => {
  // The empty bundles store: readiness cannot pin the package, so the
  // surface answers unavailable with the package reason — a title plus a
  // reason line, all of it in the chosen locale.
  function unavailableServices(): ReturnType<typeof createServices> {
    return createServices({
      bundlesStore: memoryBundles({}),
      run: { session: makeRunSession().session },
    });
  }

  test("without the run service the uk choice words the unavailable title", async () => {
    const services = createServices({});
    services.uiLocale.set("uk");
    renderRouter(withRunRoutes(services), { initialUrl: "/run/route-map" });
    expect(await screen.findByText("Сесія недоступна")).toBeTruthy();
    // The be fallback's wording is gone (criterion 1); the reason line never
    // renders without a surface (surface === null here).
    expect(screen.queryByText("Сесія недаступная")).toBeNull();
    expect(screen.queryByTestId("run-unavailable-reason")).toBeNull();
    expect(screen.getByTestId("btn-run-back")).toBeTruthy();
  });

  test("an unavailable session words the title and the reason with the uk choice", async () => {
    const services = unavailableServices();
    services.uiLocale.set("uk");
    renderRouter(withRunRoutes(services), { initialUrl: "/run/route-map" });
    expect(await screen.findByText("Сесія недоступна")).toBeTruthy();
    expect(screen.getByTestId("run-unavailable-reason").props.children).toBe("Гід не завантажений.");
    expect(screen.queryByText("Сесія недаступная")).toBeNull();
    expect(screen.queryByText("Гід не чытаецца.")).toBeNull();
  });

  test("switching the locale on the open unavailable screen rewords it in place", async () => {
    const services = unavailableServices();
    renderRouter(withRunRoutes(services), { initialUrl: "/run/route-map" });
    expect(await screen.findByText("Сесія недаступная")).toBeTruthy();
    act(() => {
      services.uiLocale.set("en");
    });
    // The switch re-renders the words in place, no restart (criterion 2) —
    // en.back («Back») differs from the be default and proves the switch
    // reached the back element too.
    expect(screen.getByText("Session unavailable")).toBeTruthy();
    expect(screen.getByTestId("run-unavailable-reason").props.children).toBe("Guide not downloaded.");
    expect(within(screen.getByTestId("btn-run-back")).getByText("Back")).toBeTruthy();
    expect(screen.queryByText("Сесія недаступная")).toBeNull();
  });

  test("the loading state without a session locale follows the uk choice", async () => {
    const pending = new Promise<Readiness>(() => {});
    const { session } = makeRunSession({ readiness: { evaluate: () => pending } });
    const services = createServices({ bundlesStore: memoryBundles(layerFiles("be")), run: { session } });
    services.uiLocale.set("uk");
    renderRouter(withRunRoutes(services), { initialUrl: "/run/route-map" });
    expect(await screen.findByText("Завантаження…")).toBeTruthy();
    expect(screen.queryByText("Загрузка…")).toBeNull();
  });

  test("a ready en session keeps its words when the UI switches to uk", async () => {
    const services = createServices({ bundlesStore: memoryBundles(layerFiles("en")), run: { session: makeRunSession().session } });
    renderRouter(withRunRoutes(services), { initialUrl: "/run/route-map" });
    await screen.findByTestId("run-map");
    act(() => {
      services.uiLocale.set("uk");
    });
    // The session's pinned locale wins over the UI choice (criterion 3):
    // the walk's words stay en, the back element keeps en too, the map and
    // its statuses are untouched.
    expect(textOf("run-status-stop-1")).toBe("Customs — pending");
    expect(within(screen.getByTestId("btn-run-back")).getByText("Back")).toBeTruthy();
    expect(screen.queryByText("Мытня — чакае")).toBeNull();
  });
});

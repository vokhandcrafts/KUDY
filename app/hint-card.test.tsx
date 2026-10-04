// G07.05 (issue #284) — the hint card render suite over the real composition
// root (rule 15): the published catalog fixtures, the ONE LocationService the
// app owns, the accepted values document and the one hint controller. The
// guards are the issue's proof: the card renders from a ready hint state only
// (the quiet/background decisions hide it — the controller suite proves the
// decisions, this suite proves the screen obeys them), a tap opens the guide
// preview the usual way and starts no audio (R07), and the dismissal clears
// the card. The durable limit rows are the node suites' provenance; this
// world's store is the memory wiring.
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";

import Map from "./map";
import PlaceDetail from "./place/[id]";
import RoutePreview from "./route/[id]";
import { createServices } from "../controllers/createServices";
import { CATALOG_FIXTURES, layoutWith, makeRunSession, serve, sha256 } from "../test/render-helpers";
import { loadGuideHintValues, type GuideHintValues } from "../services/config";
import type { GuideHintEventRecord, GuideHintStore } from "../controllers/useNearbyController";

import hintValuesJson from "../contracts/hints/guide-hints.values.v1.json";
const HINT_VALUES = hintValuesJson as GuideHintValues;

const withHintRoutes = (services: ReturnType<typeof createServices>) => ({
  _layout: layoutWith(services),
  map: Map,
  "place/[id]": PlaceDetail,
  "route/[id]": RoutePreview,
});

// The geography of the fixture guide: the guide-route-a1 point sits ~222 m
// from the emitted fix (0.001° of latitude is ~111 m) — inside the accepted
// 300 m radius, outside it for every other guide (no point at all).
const BASE = { lat: 54.4, lng: 18.6 };

// The memory limit store: the render suite's proofs are the card and the
// events; the durable rows and their limits are the node suites' provenance.
// The one behaviour it mirrors from services/db is the cooldown reading —
// shown and dismissed ids block the re-present the way guide_hint_last does.
function memoryHintStore(): GuideHintStore {
  const blocked = new Set<string>();
  return {
    recordShown: (input) => {
      for (const id of input.guideIds) blocked.add(id);
    },
    recordDismissed: (input) => {
      for (const id of input.guideIds) blocked.add(id);
    },
    sessionShown: () => [],
    cooldownBlocked: () => [...blocked],
  };
}

async function openMapWithHints(foreground: { current: boolean }, events: GuideHintEventRecord[]) {
  // The hint controller loads its offers at the root's construction — the
  // fixtures must be served before createServices, not just before the mount.
  serve(CATALOG_FIXTURES);
  const env = makeRunSession();
  let nowMs = 0;
  const services = createServices({
    catalogOrigin: "https://catalog.test",
    catalogSha256: sha256,
    location: env.location,
    audio: env.session.audio,
    now: () => nowMs,
    guideHints: {
      store: memoryHintStore(),
      values: HINT_VALUES,
      points: () => [{ guideId: "guide-route-a1", lat: BASE.lat + 0.002, lng: BASE.lng }],
      foreground: () => foreground.current,
      telemetry: { record: (event) => events.push(event) },
    },
  });
  renderRouter(withHintRoutes(services), { initialUrl: "/map" });
  await screen.findByTestId("nearby-card-offer-a1-place");
  // The open surface armed the one subscription (G07.01's guard); the hint
  // controller rides exactly that subscription.
  await waitFor(() => expect(env.locationPort.commands.filter((c) => c.startsWith("start"))).toHaveLength(1));
  const emitFix = (ms: number) => {
    nowMs = ms;
    act(() => {
      env.locationPort.emitFix(1, { lat: BASE.lat + 0.002, lng: BASE.lng, accuracy: 10, at: ms });
    });
  };
  return { env, emitFix, setNow: (ms: number) => (nowMs = ms) };
}

describe("Guide hint card (G07.05)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("PROOF: the card renders only from a ready hint state — background never renders it", async () => {
    const foreground = { current: true };
    const events: GuideHintEventRecord[] = [];
    const { emitFix, setNow } = await openMapWithHints(foreground, events);
    // The dwell: the first qualifying fix anchors, the card stays hidden.
    emitFix(0);
    expect(screen.queryByTestId("guide-hint-card")).toBeNull();
    // Twenty-one seconds of continuous presence in the zone: the card shows.
    setNow(21_000);
    emitFix(21_000);
    expect(await screen.findByTestId("guide-hint-card")).toBeTruthy();
    expect(screen.getByTestId("guide-hint-row-guide-route-a1")).toBeTruthy();
    // The one shown event, identifiers only.
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("guide_nearby_shown");
    expect(events[0].shown_guide_ids).toEqual(["guide-route-a1"]);
    // The PROOF scenario: background — the same world, the card is gone and
    // stays gone: the shown guide sits in its cooldown (the honest store),
    // so the return to the foreground re-decides to «limited», never to a
    // second presentation.
    foreground.current = false;
    emitFix(22_000);
    expect(screen.queryByTestId("guide-hint-card")).toBeNull();
    foreground.current = true;
    emitFix(23_000);
    await act(async () => {});
    expect(screen.queryByTestId("guide-hint-card")).toBeNull();
  });

  test("a tap opens the guide preview the usual way — no audio, no Start", async () => {
    const foreground = { current: true };
    const events: GuideHintEventRecord[] = [];
    const { env, emitFix, setNow } = await openMapWithHints(foreground, events);
    emitFix(0);
    setNow(21_000);
    emitFix(21_000);
    expect(await screen.findByTestId("guide-hint-card")).toBeTruthy();
    fireEvent.press(screen.getByTestId("guide-hint-row-guide-route-a1"));
    expect(await screen.findByTestId("screen-Route preview")).toBeTruthy();
    expect(events.map((event) => event.type)).toEqual(["guide_nearby_shown", "guide_nearby_opened"]);
    // R07: the hint is never an audio owner — the player received nothing.
    expect(env.audioPort.commands).toHaveLength(0);
  });

  test("the dismissal clears the card and records the dismissed event", async () => {
    const foreground = { current: true };
    const events: GuideHintEventRecord[] = [];
    const { emitFix, setNow } = await openMapWithHints(foreground, events);
    emitFix(0);
    setNow(21_000);
    emitFix(21_000);
    expect(await screen.findByTestId("guide-hint-card")).toBeTruthy();
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    fireEvent.press(screen.getByTestId("btn-hint-dismiss"));
    await act(async () => {});
    const crash = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
    errorSpy.mockRestore();
    if (crash.length > 0) throw new Error(`render crash: ${crash.slice(0, 600)}`);
    expect(screen.queryByTestId("guide-hint-card")).toBeNull();
    expect(events.map((event) => event.type)).toEqual(["guide_nearby_shown", "guide_nearby_dismissed"]);
  });
});

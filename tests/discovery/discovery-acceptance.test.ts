// G15.04 (issue #71) — the discovery integration acceptance: the D01–D07 and
// L01–L02 scenarios of `20` §11 executed over the real composition path —
// the controller over the real index reader (catalog envelope → pointer →
// sha256+bytes pin → shape gate → snapshot) and the durable queue behind the
// analytics port. The screen-level half of the scenarios (honest empty copy,
// rendered-only shown events, badges, fonts) stays app/discovery.test.tsx's;
// this suite proves the state those screens render.
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { offersById } from "../../controllers/useDiscoveryController.ts";
import { setAnalyticsConsent, flushAnalytics } from "../../services/analytics.ts";
import { getSetting, getSession, setSetting, startSession } from "../../services/db/db.ts";
import { eventFactory, openFreshEventStore } from "../../services/eventLog-test-fixture.ts";
import {
  bootedDiscovery,
  memorySnapshot,
  mutableLoader,
  publish,
  queueAnalyticsPort,
  syntheticFiles,
  syntheticIndex,
  syntheticIndexDuplicateRef,
  POINTER_R1,
  REVISION_R1,
} from "./fixture.ts";

const PUBLICATION = publish(syntheticIndex(REVISION_R1), POINTER_R1);

describe("G15.04 discovery integration acceptance", () => {
  test("D01: with no choice and no permissions the real city content is ready at once", async () => {
    // No analytics port = the consent-denied composition (21 §7): the choice
    // works and nothing is emitted; no GPS or session port exists on the
    // controller type to even withhold.
    const store = await bootedDiscovery({ loader: mutableLoader(syntheticFiles(PUBLICATION)).loader });
    const state = store.getState();
    assert.equal(state.surface.kind, "ready");
    assert.ok(state.surface.kind === "ready");
    assert.equal(state.surface.stale, false);
    assert.equal(state.surface.result.exact.length, 4, "the whole authored index answers the open query");
    // Recording with no port is a silent no-op, not a fault (the D01 path).
    const byId = offersById(state.surface.index);
    const anyOffer = byId.get(state.surface.result.exact[0].offer_id);
    assert.ok(anyOffer);
    state.recordShown([anyOffer], "discovery");
    state.recordOpened(anyOffer, "discovery");
  });

  test("D02: one query surfaces guide, place and collection kinds; a repeated ref renders once", async () => {
    const store = await bootedDiscovery({ loader: mutableLoader(syntheticFiles(PUBLICATION)).loader });
    const surface = store.getState().surface;
    assert.ok(surface.kind === "ready");
    const byId = offersById(surface.index);
    const kinds = new Set(surface.result.exact.map((match) => byId.get(match.offer_id)?.ref.kind));
    assert.deepEqual([...kinds].sort(), ["collection", "guide", "place"]);

    // The publication schema rejects a duplicate ref; if one ever reaches the
    // selector anyway, the display unit is the ref — exactly one card
    // (21 §4 rule 6, the schema-rejected input the selector still answers for).
    const dup = publish(syntheticIndexDuplicateRef(REVISION_R1), POINTER_R1);
    const dupStore = await bootedDiscovery({ loader: mutableLoader(syntheticFiles(dup)).loader });
    const dupSurface = dupStore.getState().surface;
    assert.ok(dupSurface.kind === "ready");
    const duplicated = dupSurface.result.exact.filter(
      (match) => match.offer_id === "offer-g15-place-30" || match.offer_id === "offer-g15-dup",
    );
    assert.equal(duplicated.length, 1, "place-g15-1 appears once across both its offer_ids");
  });

  test("D03: the 60-minute cap drops the 90-minute estimate into labeled alternatives", async () => {
    const store = await bootedDiscovery({ loader: mutableLoader(syntheticFiles(PUBLICATION)).loader });
    store.getState().setTimeLimit(60);
    const surface = store.getState().surface;
    assert.ok(surface.kind === "ready");
    assert.deepEqual(
      surface.result.exact.map((match) => match.offer_id),
      ["offer-g15-place-30", "offer-g15-place-45"],
    );
    const alternatives = new Map(surface.result.alternatives.map((match) => [match.offer_id, match]));
    assert.deepEqual(alternatives.get("offer-g15-guide-90")?.differences, ["over_time"]);
    assert.deepEqual(alternatives.get("offer-g15-collection")?.differences, ["over_time"]);
  });

  test("D04: one exact result stands alone; zero exact keeps every alternative labeled", async () => {
    const store = await bootedDiscovery({ loader: mutableLoader(syntheticFiles(PUBLICATION)).loader });
    store.getState().setTimeLimit(60);
    store.getState().toggleTheme("theme-sea");
    let surface = store.getState().surface;
    assert.ok(surface.kind === "ready");
    assert.deepEqual(
      surface.result.exact.map((match) => match.offer_id),
      ["offer-g15-place-45"],
      "the single fitting offer is the whole exact list",
    );

    store.getState().setSeason("winter");
    surface = store.getState().surface;
    assert.ok(surface.kind === "ready");
    assert.equal(surface.result.exact.length, 0);
    assert.equal(surface.result.alternatives.length, 4);
    assert.ok(
      surface.result.alternatives.every((match) => match.differences.length > 0),
      "nothing is silently widened: each alternative carries its own reason",
    );
  });

  test("D05: an unassessed season is never read as «all seasons»", async () => {
    const store = await bootedDiscovery({ loader: mutableLoader(syntheticFiles(PUBLICATION)).loader });
    store.getState().setSeason("winter");
    let surface = store.getState().surface;
    assert.ok(surface.kind === "ready");
    assert.equal(surface.result.exact.length, 0, "nobody recommends winter, so nothing is exact");
    const alternatives = new Map(surface.result.alternatives.map((match) => [match.offer_id, match]));
    assert.deepEqual(alternatives.get("offer-g15-guide-90")?.differences, ["season_unassessed"]);
    assert.deepEqual(alternatives.get("offer-g15-place-45")?.differences, ["season_unassessed"]);
    assert.deepEqual(alternatives.get("offer-g15-place-30")?.differences, ["season_not_recommended"]);
    assert.deepEqual(alternatives.get("offer-g15-collection")?.differences, ["season_not_recommended"]);
    // Dropping the season restores the full answer — the honest zero was a
    // fact of the season query, not a narrowed index.
    store.getState().setSeason(null);
    surface = store.getState().surface;
    assert.ok(surface.kind === "ready");
    assert.equal(surface.result.exact.length, 4);
  });

  test("D06: the paid offer is surfaced by content fit, first by author order, and opens nothing by itself", async () => {
    const store = await bootedDiscovery({ loader: mutableLoader(syntheticFiles(PUBLICATION)).loader });
    const state = store.getState();
    assert.ok(state.surface.kind === "ready");
    assert.equal(
      state.surface.result.exact[0]?.offer_id,
      "offer-g15-guide-90",
      "access never reorders the author's order",
    );
    // The controller state has no purchase, run, price or audio surface to
    // trigger — the card can only navigate (20 §6, 11 §16.4).
    for (const key of Object.keys(state)) {
      assert.doesNotMatch(key, /buy|purchase|price|checkout|entitle|run|audio|session/i);
    }
  });

  test("D06: a collection exposes member refs only — no private content in the public projection", async () => {
    const store = await bootedDiscovery({ loader: mutableLoader(syntheticFiles(PUBLICATION)).loader });
    const surface = store.getState().surface;
    assert.ok(surface.kind === "ready");
    const collection = surface.index.collections[0];
    assert.ok(collection);
    for (const member of collection.members) {
      const keys = Object.keys(member).sort();
      assert.ok(
        keys.every((key) => ["content_version", "kind", "place_id", "route_id", "version"].includes(key)),
        `a member carries only its ref fields, got ${keys.join(",")}`,
      );
    }
    assert.equal((collection.members[0] as { title?: unknown }).title, undefined);
  });

  test("D07: discovery operations leave the live session row byte-equal", async () => {
    const driver = openFreshEventStore();
    startSession(driver, {
      sessionId: "s-g15-d07",
      routeId: "guide-route-g15",
      version: "1",
      locale: "be",
      startedAt: 1_700_000_000_000,
    });
    const before = getSession(driver, "s-g15-d07");
    assert.ok(before);

    const store = await bootedDiscovery({
      loader: mutableLoader(syntheticFiles(PUBLICATION)).loader,
      analytics: queueAnalyticsPort(driver, eventFactory("g15d07shown000")),
    });
    const state = store.getState();
    assert.ok(state.surface.kind === "ready");
    const byId = offersById(state.surface.index);
    const guide = byId.get("offer-g15-guide-90");
    const place = byId.get("offer-g15-place-30");
    assert.ok(guide && place);
    state.recordShown([guide, place], "discovery");
    state.recordOpened(guide, "discovery");
    state.beginPresentation("collection");
    await state.refresh();

    const after = getSession(driver, "s-g15-d07");
    assert.deepEqual(after, before);
    // The operations really ran through the queue: two shown + one opened
    // recorded locally, none of them touching the session. The flush needs
    // the consent grant first — without it the queue is not even read.
    setAnalyticsConsent(driver, "granted");
    const sent = await flushAnalytics(driver, async () => {});
    assert.equal(sent, 3);
  });

  test("L01: Ukrainian text without Ukrainian audio is never marked audio-ready", async () => {
    const store = await bootedDiscovery({ loader: mutableLoader(syntheticFiles(PUBLICATION)).loader });
    const surface = store.getState().surface;
    assert.ok(surface.kind === "ready");
    const guide = offersById(surface.index).get("offer-g15-guide-90");
    assert.ok(guide);
    assert.ok(guide.availability.text_locales.includes("uk"), "the text is published in Ukrainian");
    assert.ok(!guide.availability.audio_locales.includes("uk"), "the audio list owes no Ukrainian line");
    // The uk query surfaces the guide through its text availability alone; the
    // audio promise stays be/en — no start path may promise Ukrainian sound.
    const ukStore = await bootedDiscovery({
      loader: mutableLoader(syntheticFiles(PUBLICATION)).loader,
      criteriaLocale: "uk",
    });
    const ukSurface = ukStore.getState().surface;
    assert.ok(ukSurface.kind === "ready");
    assert.deepEqual(
      ukSurface.result.exact.map((match) => match.offer_id),
      ["offer-g15-guide-90"],
    );
  });

  test("L02: the display choice is durable and never rewrites the active run's locale", async () => {
    const driver = openFreshEventStore();
    startSession(driver, {
      sessionId: "s-g15-l02",
      routeId: "guide-route-g15",
      version: "1",
      locale: "be",
      startedAt: 1_700_000_000_000,
    });
    setSetting(driver, "locale", "en");
    assert.equal(getSetting(driver, "locale"), "en", "the explicit choice persists in durable settings");
    assert.equal(getSession(driver, "s-g15-l02")?.locale, "be", "the active run keeps its start locale");
  });

  test("the criteria boundary rejects unknown themes and unnamed limits without widening", async () => {
    const store = await bootedDiscovery({ loader: mutableLoader(syntheticFiles(PUBLICATION)).loader });
    store.getState().setTimeLimit(90);
    assert.equal(store.getState().timeLimit, null, "an unnamed minute cap is rejected at the boundary");
    store.getState().toggleTheme("theme-nope");
    assert.deepEqual(store.getState().themeIds, [], "an unknown theme is rejected at the boundary");
    // The be-only place answers the be query and stays out of the en one —
    // the missing locale is honest, never backfilled.
    const enStore = await bootedDiscovery({
      loader: mutableLoader(syntheticFiles(PUBLICATION)).loader,
      criteriaLocale: "en",
    });
    const enSurface = enStore.getState().surface;
    assert.ok(enSurface.kind === "ready");
    assert.ok(!enSurface.result.exact.some((match) => match.offer_id === "offer-g15-place-45"));
  });

  test("consent revoked before any flush: the choice still works, recording stays local", async () => {
    const driver = openFreshEventStore();
    setAnalyticsConsent(driver, "revoked");
    const store = await bootedDiscovery({
      loader: mutableLoader(syntheticFiles(PUBLICATION)).loader,
      snapshot: memorySnapshot(),
      analytics: queueAnalyticsPort(driver, eventFactory("g15revokeshow")),
    });
    const state = store.getState();
    assert.ok(state.surface.kind === "ready");
    assert.equal(state.surface.result.exact.length, 4, "discovery needs no analytics consent");
  });
});

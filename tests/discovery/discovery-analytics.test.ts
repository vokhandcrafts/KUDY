// G15.04 (issue #71) — the analytics half of the acceptance (task step 4,
// acceptance 4): the controller's shown/opened events enter the real durable
// queue through the port adapter, leave the device only through the consent
// gate (G09.02), once per offer per presentation and per revision, with the
// exact five-field payload the event table allowlists — no feedback scores,
// no invented fields. The visible-only half (the screen tells the port only
// about rendered offers) is app/discovery.test.tsx's; here the controller
// proves the dedupe, the collection exclusion and the consent boundary.
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { offersById } from "../../controllers/useDiscoveryController.ts";
import {
  flushAnalytics,
  getAnalyticsConsent,
  setAnalyticsConsent,
} from "../../services/analytics.ts";
import type { OutgoingEvent } from "../../services/eventLog.ts";
import { eventFactory, openFreshEventStore } from "../../services/eventLog-test-fixture.ts";
import {
  bootedDiscovery,
  mutableLoader,
  publish,
  queueAnalyticsPort,
  syntheticFiles,
  syntheticIndex,
  POINTER_R1,
  REVISION_R1,
} from "./fixture.ts";

const PUBLICATION = publish(syntheticIndex(REVISION_R1), POINTER_R1);

// The exact payload the event table allowlists for discovery_offer_*
// (contracts/events/event-table.v1.json) — nothing rides besides it.
const PAYLOAD_KEYS = ["content_locale", "discovery_revision", "kind", "offer_id", "surface"];

function sentBatches() {
  const batches: OutgoingEvent[][] = [];
  return {
    batches,
    send: async (events: OutgoingEvent[]) => {
      batches.push(events);
    },
  };
}

describe("G15.04 discovery analytics consent gate", () => {
  test("shown events leave the device only after consent, payload exactly five fields", async () => {
    const driver = openFreshEventStore();
    const store = await bootedDiscovery({
      loader: mutableLoader(syntheticFiles(PUBLICATION)).loader,
      analytics: queueAnalyticsPort(driver, eventFactory("g15anashown000")),
    });
    const state = store.getState();
    assert.ok(state.surface.kind === "ready");
    assert.equal(getAnalyticsConsent(driver), null, "consent was never asked");

    const byId = offersById(state.surface.index);
    const guide = byId.get("offer-g15-guide-90");
    const place = byId.get("offer-g15-place-30");
    assert.ok(guide && place);
    state.recordShown([guide, place], "discovery");
    state.recordShown([guide, place], "discovery");

    const { batches, send } = sentBatches();
    assert.equal(await flushAnalytics(driver, send), 0, "no consent — no outbound work at all");
    assert.equal(batches.length, 0);

    setAnalyticsConsent(driver, "granted");
    assert.equal(await flushAnalytics(driver, send), 2, "both shown events were still pending, one batch");
    assert.equal(batches.length, 1);
    assert.deepEqual(
      batches[0].map((event) => event.type),
      ["discovery_offer_shown", "discovery_offer_shown"],
    );
    for (const event of batches[0]) {
      const payload = event.payload as Record<string, unknown>;
      assert.deepEqual(Object.keys(payload).sort(), PAYLOAD_KEYS);
      assert.equal(payload.discovery_revision, REVISION_R1);
      assert.equal(payload.surface, "discovery");
      assert.equal(payload.content_locale, "be");
      assert.equal("time_bucket" in payload, false, "the optional bucket stays unwired in this release");
      assert.equal(
        Object.keys(payload).some((key) => /rating|score|feedback|star/i.test(key)),
        false,
        "no feedback score rides on a shown event",
      );
    }

    // The per-presentation dedupe holds across flushes: a re-record of the
    // same presentation queues nothing more, and an empty queue wakes no
    // transport.
    state.recordShown([guide, place], "discovery");
    assert.equal(await flushAnalytics(driver, send), 0);
    assert.equal(batches.length, 1);
  });

  test("a collection card carries no shown/opened event; the opened payload follows the same allowlist", async () => {
    const driver = openFreshEventStore();
    const store = await bootedDiscovery({
      loader: mutableLoader(syntheticFiles(PUBLICATION)).loader,
      analytics: queueAnalyticsPort(driver, eventFactory("g15anaopened00")),
    });
    const state = store.getState();
    assert.ok(state.surface.kind === "ready");
    const byId = offersById(state.surface.index);
    const collection = byId.get("offer-g15-collection");
    const guide = byId.get("offer-g15-guide-90");
    assert.ok(collection && guide);

    // The event kind enum is guide | place — a collection offer has no
    // shown/opened event in this release (event-table.v1.json).
    state.recordShown([collection], "discovery");
    state.recordOpened(collection, "discovery");
    state.recordOpened(guide, "discovery");

    setAnalyticsConsent(driver, "granted");
    const { batches, send } = sentBatches();
    assert.equal(await flushAnalytics(driver, send), 1, "only the guide's opened event exists in the queue");
    assert.equal(batches[0][0].type, "discovery_offer_opened");
    assert.deepEqual(Object.keys(batches[0][0].payload as Record<string, unknown>).sort(), PAYLOAD_KEYS);
  });

  test("a withdrawal stops the sending and keeps the tail pending for the next grant", async () => {
    const driver = openFreshEventStore();
    const store = await bootedDiscovery({
      loader: mutableLoader(syntheticFiles(PUBLICATION)).loader,
      analytics: queueAnalyticsPort(driver, eventFactory("g15anarevoke0")),
    });
    const state = store.getState();
    assert.ok(state.surface.kind === "ready");
    const byId = offersById(state.surface.index);
    const place = byId.get("offer-g15-place-30");
    assert.ok(place);

    state.recordShown([place], "discovery");
    setAnalyticsConsent(driver, "granted");
    const { batches, send } = sentBatches();
    assert.equal(await flushAnalytics(driver, send), 1);

    // The same offer on the collection surface is a different presentation —
    // it queues, and the withdrawal stops it from leaving.
    state.recordShown([place], "collection");
    setAnalyticsConsent(driver, "revoked");
    assert.equal(await flushAnalytics(driver, send), 0, "the withdrawal stops every outbound batch");
    assert.equal(batches.length, 1, "no request left while revoked");

    setAnalyticsConsent(driver, "granted");
    assert.equal(await flushAnalytics(driver, send), 1, "the pending tail survives the revoked period");
    assert.equal(batches.length, 2);
    assert.equal((batches[1][0].payload as Record<string, unknown>).surface, "collection");
  });
});

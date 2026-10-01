// G15.04 (issue #71) — the publication half of the acceptance (task step 3,
// acceptance 5): an interrupted or corrupt publication rolls the discovery
// index back to the previous pointer with its snapshot byte-identical, an
// active presentation keeps crediting its own revision and re-credits under
// the new one, and the downloaded guide package is never touched by any of
// it. Every path runs through the real reader and controller — no fixture
// reader of its own.
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { offersById, type DiscoveryOfferEvent } from "../../controllers/useDiscoveryController.ts";
import { loadDiscoveryIndex } from "../../services/contentRepo/discoveryIndex.ts";
import { storeAt, tempPackage } from "../../services/contentRepo/test-fixture.ts";
import {
  bootedDiscovery,
  memorySnapshot,
  mutableLoader,
  publish,
  sha256,
  syntheticFiles,
  syntheticIndex,
  POINTER_R1,
  POINTER_R2,
  REVISION_R1,
  REVISION_R2,
} from "./fixture.ts";

const R1 = publish(syntheticIndex(REVISION_R1), POINTER_R1);
const R2 = publish(syntheticIndex(REVISION_R2), POINTER_R2);

type Publication = typeof R1;

// One altered character: the same declared size and a stale sha256 in the
// envelope — exactly what a torn or doctored publication serves.
const tampered = (publication: Publication): string =>
  publication.indexJson.replace("Сукнаскі", "Сукняскі");

function spyPort() {
  const shown: DiscoveryOfferEvent[] = [];
  return {
    shown,
    port: {
      offerShown: (event: DiscoveryOfferEvent) => void shown.push(event),
      offerOpened: (_event: DiscoveryOfferEvent) => {},
    },
  };
}

describe("G15.04 publication rollback and the downloaded guide", () => {
  test("a fresh publication replaces the snapshot and serves the new revision", async () => {
    const snapshot = memorySnapshot();
    const box = mutableLoader(syntheticFiles(R1));
    const first = await loadDiscoveryIndex({ loader: box.loader, sha256, snapshot });
    assert.ok(first.kind === "ready" && first.revision === REVISION_R1 && first.stale === false);
    assert.equal(Buffer.from(snapshot.bytes() ?? new Uint8Array()).toString("utf8"), R1.indexJson);

    box.setFiles(syntheticFiles(R2));
    const second = await loadDiscoveryIndex({ loader: box.loader, sha256, snapshot });
    assert.ok(second.kind === "ready" && second.revision === REVISION_R2 && second.stale === false);
    assert.equal(Buffer.from(snapshot.bytes() ?? new Uint8Array()).toString("utf8"), R2.indexJson);
  });

  test("an interrupted publication rolls back to the previous pointer, snapshot byte-identical", async () => {
    const snapshot = memorySnapshot();
    const box = mutableLoader(syntheticFiles(R1));
    const first = await loadDiscoveryIndex({ loader: box.loader, sha256, snapshot });
    assert.ok(first.kind === "ready");

    // The pointer moved to r2 but the index fetch dies mid-refresh — the
    // publication's interruption (task step 3).
    box.setFiles({ "catalog.json": R2.catalogJson });
    const interrupted = await loadDiscoveryIndex({ loader: box.loader, sha256, snapshot });
    assert.ok(interrupted.kind === "ready");
    assert.equal(interrupted.revision, REVISION_R1, "the previous pointer's revision stays active");
    assert.equal(interrupted.stale, true);
    assert.equal(interrupted.reason, "index-fetch-failed");
    assert.equal(
      Buffer.from(snapshot.bytes() ?? new Uint8Array()).toString("utf8"),
      R1.indexJson,
      "the snapshot is byte-identical to the previous publication",
    );
  });

  test("corrupt publication bytes fail the pin and keep the previous revision", async () => {
    const snapshot = memorySnapshot();
    const box = mutableLoader(syntheticFiles(R1));
    assert.ok((await loadDiscoveryIndex({ loader: box.loader, sha256, snapshot })).kind === "ready");

    box.setFiles({ "catalog.json": R2.catalogJson, [POINTER_R2]: tampered(R2) });
    const corrupt = await loadDiscoveryIndex({ loader: box.loader, sha256, snapshot });
    assert.ok(corrupt.kind === "ready");
    assert.equal(corrupt.revision, REVISION_R1);
    assert.equal(corrupt.reason, "index-pin-mismatch");
    assert.equal(Buffer.from(snapshot.bytes() ?? new Uint8Array()).toString("utf8"), R1.indexJson);
  });

  test("an active presentation credits its own revision through a failed refresh, then the new one", async () => {
    const snapshot = memorySnapshot();
    const box = mutableLoader(syntheticFiles(R1));
    const { port, shown } = spyPort();
    const store = await bootedDiscovery({ loader: box.loader, snapshot, analytics: port });
    let surface = store.getState().surface;
    assert.ok(surface.kind === "ready");
    assert.equal(surface.revision, REVISION_R1);

    const guide = offersById(surface.index).get("offer-g15-guide-90");
    const place = offersById(surface.index).get("offer-g15-place-30");
    assert.ok(guide && place);
    store.getState().recordShown([guide], "discovery");
    assert.deepEqual(shown.map((event) => event.discovery_revision), [REVISION_R1]);

    box.setFiles({ "catalog.json": R2.catalogJson });
    await store.getState().refresh();
    surface = store.getState().surface;
    assert.ok(surface.kind === "ready");
    assert.equal(surface.revision, REVISION_R1, "the failed refresh keeps the old-version presentation");
    assert.equal(surface.stale, true);
    store.getState().recordShown([place], "discovery");
    assert.deepEqual(
      shown.map((event) => event.discovery_revision),
      [REVISION_R1, REVISION_R1],
      "the old-version presentation keeps crediting its own revision",
    );

    // The publication recovers: the new revision is a new content
    // presentation — the same offer re-credits under it (21 §7).
    box.setFiles(syntheticFiles(R2));
    await store.getState().refresh();
    surface = store.getState().surface;
    assert.ok(surface.kind === "ready");
    assert.equal(surface.revision, REVISION_R2);
    assert.equal(surface.stale, false);
    store.getState().recordShown([guide], "discovery");
    assert.deepEqual(
      shown.map((event) => event.discovery_revision),
      [REVISION_R1, REVISION_R1, REVISION_R2],
    );
  });

  test("a corrupt publication does not break the downloaded guide package", async () => {
    const downloaded = tempPackage();
    try {
      const store = storeAt(downloaded.root);
      const before = await store.readFile("route.json");
      assert.ok(await store.exists("be/base/audio/story-b.m4a"));

      // The publication corrupts under the same host: the discovery refresh
      // faults — and the package store still reads the same bytes.
      const snapshot = memorySnapshot();
      const box = mutableLoader(syntheticFiles(R1));
      assert.ok((await loadDiscoveryIndex({ loader: box.loader, sha256, snapshot })).kind === "ready");
      box.setFiles({ "catalog.json": "not json at all" });
      const corrupt = await loadDiscoveryIndex({ loader: box.loader, sha256, snapshot });
      assert.ok(corrupt.kind === "ready" && corrupt.stale === true);
      assert.deepEqual(await store.readFile("route.json"), before, "the downloaded package is untouched");
    } finally {
      downloaded.remove();
    }
  });
});

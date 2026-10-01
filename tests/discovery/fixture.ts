// G15.04 (issue #71) — shared arrange for the discovery integration
// acceptance suites: the synthetic city publication (all three offer kinds,
// a guide with Ukrainian text and no Ukrainian audio), the mutable
// publication box the interrupted-refresh scenarios repoint between loads,
// and the analytics adapter that records the controller's port events into
// the real durable queue. Test-only module — imported by the tests/discovery
// suites, never by production code (implementation-rules 3: one spelling).
import { createHash } from "node:crypto";

import type { DiscoveryIndexV1 } from "../../core/discovery/selectDiscovery.ts";
import {
  createDiscoveryController,
  type DiscoveryAnalyticsPort,
  type DiscoveryOfferEvent,
} from "../../controllers/useDiscoveryController.ts";
import { waitUntil } from "../../controllers/catalog/test-helpers.ts";
import type { CatalogPathLoader } from "../../services/catalog/types.ts";
import { loadDiscoveryIndex, type DiscoverySnapshotStore } from "../../services/contentRepo/discoveryIndex.ts";
import { emitEvent } from "../../services/eventLog.ts";
import type { EventInput, SqlDriver } from "../../services/db/types.ts";

export const REVISION_R1 = "r-g15-1";
export const REVISION_R2 = "r-g15-2";
export const POINTER_R1 = `discovery/city-g15/${REVISION_R1}/index.json`;
export const POINTER_R2 = `discovery/city-g15/${REVISION_R2}/index.json`;

export const sha256 = async (bytes: Uint8Array): Promise<string> =>
  createHash("sha256").update(bytes).digest("hex");

// The synthetic city (task step 1): a paid guide with a 90-minute upper
// estimate and Ukrainian text but no Ukrainian audio, two places (one be-only
// — the missing-locale path), and a mixed collection over two of them. The
// empty season_recommendations arrays are «не ацэнена», never «усе сезоны»
// (20 §5).
export function syntheticIndex(revision: string): DiscoveryIndexV1 {
  return {
    schema_version: 1,
    revision,
    city_id: "city-g15",
    themes: [
      { id: "theme-history", labels: { be: "Гісторыя", en: "History" } },
      { id: "theme-sea", labels: { be: "Мора", en: "Sea" } },
    ],
    offers: [
      {
        offer_id: "offer-g15-guide-90",
        ref: { kind: "guide", route_id: "guide-route-g15", version: "1" },
        city_id: "city-g15",
        editorial_order: 0,
        themes: ["theme-history"],
        localized: {
          title: { be: "Сукнаскі Гданьск", en: "Cloth Danzig", uk: "Сукнянський Гданськ" },
          summary: { be: "Гід па сукнаму цэху.", en: "A guide along the cloth guild.", uk: "Гід сукнярським цехом." },
          why_recommended: {
            be: "Поўная гісторыя цэху за адзін маршрут.",
            en: "The full guild history in one walk.",
            uk: "Повна історія цеху за один маршрут.",
          },
          conditions: { be: "большасць шляху на вуліцы", en: "most of the way is outdoors", uk: "більшаість шляху надвор'ям" },
        },
        estimated_duration: { min_minutes: 60, max_minutes: 90, basis: "author_estimate" },
        season_recommendations: [],
        availability: { text_locales: ["be", "en", "uk"], audio_locales: ["be", "en"] },
        access: "paid",
        detail_ref: { kind: "guide_preview" },
      },
      {
        offer_id: "offer-g15-place-30",
        ref: { kind: "place", place_id: "place-g15-1", content_version: "1" },
        city_id: "city-g15",
        editorial_order: 1,
        themes: ["theme-history"],
        localized: {
          title: { be: "Двор сукнараў", en: "Cloth courtyard" },
          summary: { be: "Ціхі дворык каля гарадской сцэны.", en: "A quiet courtyard by the town wall." },
          why_recommended: { be: "Дваццаць хвілін цішыні ў цэнтры.", en: "Twenty quiet minutes downtown." },
          conditions: { be: "большасць шляху на вуліцы", en: "most of the way is outdoors" },
        },
        estimated_duration: { min_minutes: 20, max_minutes: 30, basis: "author_walk" },
        season_recommendations: [{ season: "summer", reason: { be: "Цень у спёку.", en: "Shade in the heat." } }],
        availability: { text_locales: ["be", "en"], audio_locales: [] },
        access: "free",
        detail_ref: { kind: "place_public", path: "places/place-g15-1/public.json" },
      },
      {
        offer_id: "offer-g15-place-45",
        ref: { kind: "place", place_id: "place-g15-2", content_version: "1" },
        city_id: "city-g15",
        editorial_order: 2,
        themes: ["theme-sea"],
        localized: {
          title: { be: "Морскі павільён", en: "Sea pavilion" },
          summary: { be: "Павільён над вадой з відам на порт.", en: "A pavilion over the water facing the port." },
          why_recommended: { be: "Кароткі прагулянкі з марскім паветрам.", en: "A short walk with the sea air." },
          conditions: { be: "адкрытая пляцоўка, ветрана", en: "open deck, windy" },
        },
        estimated_duration: { min_minutes: 30, max_minutes: 45, basis: "author_walk" },
        season_recommendations: [],
        availability: { text_locales: ["be"], audio_locales: [] },
        access: "free",
        detail_ref: { kind: "place_public", path: "places/place-g15-2/public.json" },
      },
      {
        offer_id: "offer-g15-collection",
        ref: { kind: "collection", collection_id: "collection-g15", content_version: "1" },
        city_id: "city-g15",
        editorial_order: 3,
        themes: ["theme-history", "theme-sea"],
        localized: {
          title: { be: "Адзін дзень у порце", en: "One day at the port" },
          summary: { be: "Дзве прапановы адной маршрутакі.", en: "Two offers in one arc." },
          why_recommended: { be: "Адзін дзень — і двор, і гід.", en: "One day covers the courtyard and the guide." },
          conditions: { be: "гід у падборцы платны", en: "the guide inside is paid" },
        },
        estimated_duration: { min_minutes: 90, max_minutes: 120, basis: "author_estimate" },
        season_recommendations: [{ season: "autumn", reason: { be: "Яблыкі на набярэжнай.", en: "Apples on the promenade." } }],
        availability: { text_locales: ["be", "en"], audio_locales: [] },
        access: "mixed",
        detail_ref: { kind: "collection_public", path: "collections/collection-g15/public.json" },
      },
    ],
    collections: [
      {
        collection_id: "collection-g15",
        content_version: "1",
        city_id: "city-g15",
        localized: {
          title: { be: "Адзін дзень у порце", en: "One day at the port" },
          description: {
            be: "Дзве прапановы ў адным маршэ: кароткі двор і поўны гід ад таго ж двара.",
            en: "Two offers in one arc: the short courtyard and the full guide from the same courtyard.",
          },
        },
        members: [
          { kind: "place", place_id: "place-g15-1", content_version: "1" },
          { kind: "guide", route_id: "guide-route-g15", version: "1" },
        ],
        overlap_note: { be: "Дзве прапановы перасякаюцца з гідам.", en: "Two offers overlap the guide." },
      },
    ],
  };
}

// The D02 defensive-dedupe variant: the publication schema rejects a repeated
// ref (G02.03), and the selector still owes the one-ref-once answer if one
// ever reaches it (21 §4 rule 6).
export function syntheticIndexDuplicateRef(revision: string): DiscoveryIndexV1 {
  const index = syntheticIndex(revision);
  const repeated = index.offers.find((offer) => offer.offer_id === "offer-g15-place-30");
  if (!repeated) throw new Error("fixture invariant: the place-30 offer exists");
  return { ...index, offers: [...index.offers, { ...repeated, offer_id: "offer-g15-dup" }] };
}

// The publication envelope: the catalog names the index path, byte length and
// sha256 — the reader's integrity pin verifies the served bytes against it.
export interface Publication {
  readonly catalogJson: string;
  readonly indexJson: string;
  readonly pointerPath: string;
  readonly revision: string;
}

export function publish(index: DiscoveryIndexV1, pointerPath: string): Publication {
  const indexJson = JSON.stringify(index);
  const bytes = Buffer.from(indexJson, "utf8");
  const catalog = {
    catalog_schema_version: 1,
    generated_at: "2026-10-01T00:00:00Z",
    routes: [],
    discovery_index: {
      schema_version: 1,
      revision: index.revision,
      path: pointerPath,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
  return { catalogJson: JSON.stringify(catalog), indexJson, pointerPath, revision: index.revision };
}

export function syntheticFiles(publication: Publication): Record<string, string> {
  return { "catalog.json": publication.catalogJson, [publication.pointerPath]: publication.indexJson };
}

// The mutable publication box: the interruption scenarios repoint the served
// files between loads — the reader always reads through this one loader.
export function mutableLoader(
  initial: Record<string, string>,
): { loader: CatalogPathLoader; setFiles: (next: Record<string, string>) => void } {
  let files = initial;
  return {
    loader: (relPath) =>
      relPath in files ? Promise.resolve(files[relPath]) : Promise.reject(new Error(`unexpected: ${relPath}`)),
    setFiles: (next) => {
      files = next;
    },
  };
}

export function memorySnapshot(): DiscoverySnapshotStore & { bytes: () => Uint8Array | null } {
  let bytes: Uint8Array | null = null;
  return {
    read: async () => bytes,
    write: async (next: Uint8Array) => {
      bytes = next;
    },
    bytes: () => bytes,
  };
}

export interface DiscoveryBoot {
  readonly loader: CatalogPathLoader;
  readonly snapshot?: DiscoverySnapshotStore;
  readonly analytics?: DiscoveryAnalyticsPort;
  readonly criteriaLocale?: string;
}

// The real composition path: the controller over the real index reader — the
// same wiring createServices performs, with fixture ports for the network
// edges (implementation-rules 15: helpers arrange, never pre-process).
export async function bootedDiscovery(boot: DiscoveryBoot) {
  const snapshot = boot.snapshot ?? memorySnapshot();
  const store = createDiscoveryController({
    service: { load: () => loadDiscoveryIndex({ loader: boot.loader, sha256, snapshot }) },
    criteriaLocale: boot.criteriaLocale ?? "be",
    analytics: boot.analytics,
  });
  await waitUntil(() => store.getState().surface.kind !== "loading");
  return store;
}

// The analytics adapter the composition root will own (M5/G06): the
// controller's port events go into the real durable queue under the
// event-table types; the consent gate and the transport stay analytics.ts's
// own paths (G09.01/G09.02) — this fixture invents neither.
export function queueAnalyticsPort(
  driver: SqlDriver,
  event: (overrides?: Partial<EventInput>) => EventInput,
): DiscoveryAnalyticsPort {
  const record = (e: DiscoveryOfferEvent, type: "discovery_offer_shown" | "discovery_offer_opened"): void => {
    emitEvent(driver, event({ type, payload: JSON.stringify(e) }));
  };
  return {
    offerShown: (e) => record(e, "discovery_offer_shown"),
    offerOpened: (e) => record(e, "discovery_offer_opened"),
  };
}


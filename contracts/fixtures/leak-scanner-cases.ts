// TR-7 (docs/architecture/23_technical_remarks.md) — the single shared set of
// negative leak fixtures for the two deliberately independent scanners: the
// packager (tools/build-bundle/build-bundle.mjs, scanPublicForLeaks, 09 §12)
// and the web input guard (web/lib/content/leak-guard.ts, scanWebContentInput,
// G10.01.a criterion 3). The implementations are never merged; the error
// CLASSES they report are the shared contract. The fixtures are therefore
// scanner-neutral payloads: each side's parity test
// (tools/build-bundle/leak-parity.test.mjs, web/lib/content/leak-parity.test.ts)
// maps the same payload onto its own input format and requires its scanner to
// reject it with exactly `code` and to accept the `accept` twin, which is the
// same file shape with that one defect removed. A class fixed on one scanner
// but not the other — or a code renamed on either side — fails the parity test
// on the drifting side.
//
// All payloads attach to the demo author tree (rule 14: one isolated violation
// per fixture, named by `code`).

export interface LeakFixturePayload {
  /** A file dropped into the public base tier of `locale`. */
  publicFile?: { name: string; content: string };
  /** Fields merged into the place projection — the one rel identical on both sides of the packager boundary. */
  projectionFields?: Record<string, string>;
  /** A string put into the public base story's `note` field. */
  publicNote?: string;
  /** Narration written under the private story's `text` key. */
  privateText?: string;
}

export interface LeakScannerCase {
  id: 'source-map' | 'private-path' | 'private-text';
  /** The shared class, spelled the way both scanners name it today. */
  code: 'source-map-in-public' | 'private-path-in-public' | 'private-text-leak';
  reject: LeakFixturePayload;
  accept: LeakFixturePayload;
}

// The demo author tree every payload attaches to; the story ids and the
// projection are part of the fixture, so both harnesses poison the same spots.
export const LEAK_FIXTURE_LAYOUT = {
  authorTree: 'fixtures/content/demo-route',
  locale: 'be',
  bundleRoot: 'bundle/demo-route-a1/1',
  baseStoryId: 'story-1-base',
  privateStoryId: 'story-2-ext',
  projectionRel: 'places/place-1/public.json',
} as const;

const SOURCE_MAP_CONTENT = '{"version":3,"sources":["../../be/extended/story-2-ext.ts"],"file":"story.js"}';

// Synthetic narration with well over eight tokens; the clean note shares no
// 8-gram with it and none with the demo tree's own private text.
const PRIVATE_NARRATION =
  'Платны дэма-тэкст сканераў парытэту: першы токен другі токен трэці токен чацвёрты токен пяты токен шосты токен сёмы токен.';
const CLEAN_PUBLIC_NOTE =
  'Публічная нататка двара сукнараў: свабодны пласт апавядае пра гандаль сукном і рэштку сцяны.';

export const LEAK_SCANNER_CASES: LeakScannerCase[] = [
  {
    id: 'source-map',
    code: 'source-map-in-public',
    reject: { publicFile: { name: 'story.js.map', content: SOURCE_MAP_CONTENT } },
    accept: { publicFile: { name: 'story.js.txt', content: SOURCE_MAP_CONTENT } },
  },
  {
    id: 'private-path',
    code: 'private-path-in-public',
    reject: {
      projectionFields: {
        audio_path: `private/${LEAK_FIXTURE_LAYOUT.bundleRoot}/${LEAK_FIXTURE_LAYOUT.locale}/extended/audio/story-2-ext.m4a`,
      },
    },
    accept: {
      projectionFields: {
        audio_path: `${LEAK_FIXTURE_LAYOUT.bundleRoot}/${LEAK_FIXTURE_LAYOUT.locale}/base/audio/story-1-base.m4a`,
      },
    },
  },
  {
    id: 'private-text',
    code: 'private-text-leak',
    reject: { privateText: PRIVATE_NARRATION, publicNote: PRIVATE_NARRATION },
    accept: { privateText: PRIVATE_NARRATION, publicNote: CLEAN_PUBLIC_NOTE },
  },
];

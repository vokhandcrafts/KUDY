// G04.03 — shared package fixtures for the acceptance suite and the demo.
// One synthetic paid guide (route-x@1, be layer with audio, en-free) that the
// tests punch holes into and the demo walks through the readiness states.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createNodePackageStore } from './nodePackageStore.ts';
import type { PackageKey, PackageStore } from './types.ts';

export const KEY: PackageKey = { routeId: 'route-x', version: '1' };

const ROUTE = {
  route_id: 'route-x',
  version: '1',
  city_id: 'city-x',
  access: 'paid',
  stops: [
    { id: 'stop-1', position: 0, place_id: 'place-1', access_tier: 'base' },
    { id: 'stop-2', position: 1, place_id: 'place-2', access_tier: 'extended' },
  ],
};
const PLACES = [{ id: 'place-1' }, { id: 'place-2' }];
const VOICES = [{ id: 'voice-1', locale: 'be' }, { id: 'voice-2', locale: 'en' }];
const BASE_STOPS = [{ story_id: 'story-b', place_id: 'place-1', voice_id: 'voice-1', tier: 'base', duration_s: 60, text: 'т', transcript: 'т', sources: ['с'] }];
const EXT_STOPS = [{ story_id: 'story-e', place_id: 'place-2', voice_id: 'voice-1', tier: 'extended', duration_s: 60, text: 'т', transcript: 'т', sources: ['с'] }];
const AUDIO = 'm4a-placeholder';

export function writeSamplePackage(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const write = (rel: string, data: string) => {
    const abs = `${dir}/${rel}`;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, data);
  };
  write('route.json', JSON.stringify(ROUTE));
  write('places.json', JSON.stringify(PLACES));
  write('voices.json', JSON.stringify(VOICES));
  write('be/base/stops.json', JSON.stringify(BASE_STOPS));
  write('be/extended/stops.json', JSON.stringify(EXT_STOPS));
  write('be/base/audio/story-b.m4a', AUDIO);
  write('be/extended/audio/story-e.m4a', AUDIO);
  write('discovery.json', JSON.stringify({ revision: 'r-1', city_id: 'city-x', offers: [] }));
  return dir;
}

export function tempPackage(): { root: string; remove: () => void } {
  const root = writeSamplePackage(fs.mkdtempSync(path.join(os.tmpdir(), 'g0403-')));
  return { root, remove: () => fs.rmSync(root, { recursive: true, force: true }) };
}

export function storeAt(root: string, key: PackageKey = KEY): PackageStore {
  return createNodePackageStore(root, key);
}

// Store wrapper for conditions the fs cannot produce portably (e.g. EACCES on
// Windows): the real package is served, but one named path reads as unreadable.
export function stubWithUnreadable(store: PackageStore, unreadableRel: string): PackageStore {
  return {
    key: store.key,
    async readFile(rel: string) {
      return rel === unreadableRel ? { kind: 'unreadable' } : store.readFile(rel);
    },
    exists: (rel: string) => store.exists(rel),
  };
}

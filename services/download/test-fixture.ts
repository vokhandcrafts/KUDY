// Shared test fixtures for services/download (download.test.ts, grant.test.ts,
// access.test.ts, delete.test.ts): a lock.json built from the real bytes of
// the sources, so activation hash checks verify against honest digests; the
// activation rig (store + counting fetch + fresh driver) shared by the suites
// that drive activate(); a recording store wrapper for the before-any-call
// validation tests.
import fs from 'node:fs';
import path from 'node:path';

import { openDatabase } from '../db/db.ts';
import { nodeSqliteDriver } from '../db/test-fixture.ts';
import type { SqlDriver } from '../db/types.ts';
import { createNodeDownloadStore, nodeSha256 } from './nodeDownloadStore.ts';
import { createAccessPort } from './access.ts';
import type { ActivateDeps, FetchPort, DownloadStore } from './types.ts';

export const utf8 = (text: string) => new TextEncoder().encode(text);

// A two-file layer: a JSON file at the root and audio inside a subdirectory —
// both shapes the lock of a real layer carries (build-bundle README).
export const STOPS = utf8('{"stops":[]}\n');
export const AUDIO = utf8('audio-bytes-0123456789abcdef');
export const GOOD: Record<string, Uint8Array> = {
  'stops.json': STOPS,
  'audio/story-1.m4a': AUDIO,
};

export async function lockFrom(sources: Record<string, Uint8Array>): Promise<unknown> {
  const lock: Array<{ path: string; bytes: number; sha256: string }> = [];
  for (const [lockPath, bytes] of Object.entries(sources)) {
    lock.push({ path: lockPath, bytes: bytes.length, sha256: await nodeSha256(bytes) });
  }
  return lock;
}

// Simulates process death at a chosen rename: the wrapped store throws
// instead of performing it (a real rename is atomic — it either happened or
// it did not, and the injected crash is the "did not" side).
export function crashOnRename(
  store: ActivateDeps['store'],
  target: (from: string, to: string) => boolean,
): ActivateDeps['store'] {
  return {
    ...store,
    rename: async (fromRel: string, toRel: string) => {
      if (target(fromRel, toRel)) throw new Error('injected crash');
      return store.rename(fromRel, toRel);
    },
  };
}

export function openFresh(): SqlDriver {
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  return driver;
}

// Recursively reads a directory into rel-path → hex-bytes entries, so
// byte-identity of a layer before and after an operation is assertable.
export function snapshotDir(root: string, rel: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const child = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else out.set(child, fs.readFileSync(path.join(root, child)).toString('hex'));
    }
  };
  if (fs.existsSync(path.join(root, rel))) walk(rel);
  return out;
}

export interface DepsOptions {
  driver?: SqlDriver;
  freeBytes?: number | null;
  sources?: Record<string, Uint8Array>;
}

// Test rig: node store over a fresh tmp root, a counting fetch port over the
// given sources (the port is bound to the layer identity by the caller, as
// G04.02.b will bind it to the grant), and a fresh in-memory store driver.
export function depsFor(root: string, options: DepsOptions = {}): { deps: ActivateDeps; fetchLog: string[] } {
  const sources = options.sources ?? GOOD;
  const store = createNodeDownloadStore(root);
  if (options.freeBytes !== undefined) store.freeBytes = async () => options.freeBytes ?? null;
  const fetchLog: string[] = [];
  const fetch: FetchPort = async (rel) => {
    fetchLog.push(rel);
    const bytes = sources[rel];
    if (!bytes) throw new Error(`no source bytes for ${rel}`);
    return bytes;
  };
  return { fetchLog, deps: { store, fetch, sha256: nodeSha256, driver: options.driver ?? openFresh(), access: createAccessPort() } };
}

// A store wrapper that records every method name invoked on it — the
// before-any-filesystem-call proof of the input-validation tests (the spy
// must wrap the store, not the functions, so the core cannot bypass it).
export function recordingStore(store: DownloadStore): { store: DownloadStore; calls: string[] } {
  const calls: string[] = [];
  const spy = new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          calls.push(String(prop));
          return (value as (...a: unknown[]) => unknown)(...args);
        };
      }
      return value;
    },
  }) as DownloadStore;
  return { store: spy, calls };
}

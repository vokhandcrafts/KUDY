// G22.02 (issue #607) — the teaser-audio probe over the real node adapter
// and the reader wired through it. Every case runs on the actual filesystem
// (a per-test tmpdir): the metadata negatives (missing, directory, empty)
// and the POSIX permission negative are real-fs behavior, and the discovery
// proof measures the audio bytes flowing through the store — none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readMomentFacts } from './momentFacts.ts';
import { createNodeBundlesStore, createNodeTeaserAudioProbe } from './nodeBundlesStore.ts';
import type { BundlesStore, FileFacts } from './types.ts';

// The POSIX-only skip reasons carry their limits in the reason itself
// (issue #607 AC4: Windows limitations are named, Linux negatives stay
// required); the platform-independent cases run everywhere.
const posixPermissionsSkip =
  process.platform === 'win32'
    ? 'Windows does not enforce Unix permission bits — the limitation issue #607 AC4 names; the metadata negatives run there too'
    : undefined;
const fdCountSkip =
  process.platform === 'linux'
    ? undefined
    : 'the open-fd census reads /proc/self/fd — a Linux facility; Windows handle release is covered by the bounded-open contract';

// Counting wrapper: the real adapter underneath, the wrapper only measures —
// the discovery proof reads the meter, not the implementation (issue #607
// AC1: measured on the real adapter, not source-grepped).
class MeasuringStore implements BundlesStore {
  audioBytesRead = 0;
  private readonly inner: BundlesStore;
  constructor(inner: BundlesStore) {
    this.inner = inner;
  }
  listDir(rel: string): Promise<string[] | null> {
    return this.inner.listDir(rel);
  }
  async readFile(rel: string): Promise<FileFacts> {
    const file = await this.inner.readFile(rel);
    if (rel.endsWith('.m4a') && file.kind === 'present') this.audioBytesRead += file.bytes.length;
    return file;
  }
  statSize(rel: string): Promise<number | null> {
    return this.inner.statSize(rel);
  }
}

const AUDIO = 'fake-m4a-bytes';

function writePackage(
  root: string,
  audioBe: string | null,
  audioEn: string | null,
): void {
  const base = path.join(root, 'bundles', 'route-a', '1');
  mkdirSync(path.join(base, 'be', 'base', 'audio'), { recursive: true });
  mkdirSync(path.join(base, 'en', 'base', 'audio'), { recursive: true });
  writeFileSync(
    path.join(base, 'moments.json'),
    JSON.stringify([{ id: 'm-1', place_id: 'place-1', story_id: 's-1', kind: 'teaser', cooldown_min: 60 }]),
  );
  if (audioBe !== null) writeFileSync(path.join(base, 'be', 'base', 'audio', 's-1.m4a'), audioBe);
  if (audioEn !== null) writeFileSync(path.join(base, 'en', 'base', 'audio', 's-1.m4a'), audioEn);
}

test('teaser_discovery_does_not_read_audio_body: the card resolves the teaser path without the .m4a bytes', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'g2202-probe-'));
  try {
    writePackage(root, AUDIO, AUDIO);
    const meter = new MeasuringStore(createNodeBundlesStore(root));
    const result = await readMomentFacts(meter, {
      locales: ['be', 'en'],
      audioProbe: createNodeTeaserAudioProbe(root),
    });
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.moments[0]?.audioPath, 'bundles/route-a/1/be/base/audio/s-1.m4a');
    // The probe answered availability; the store never carried the audio body.
    assert.equal(meter.audioBytesRead, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('invalid_media_metadata_falls_back: empty media falls to the next locale, never a dead path', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'g2202-probe-'));
  try {
    writePackage(root, '', AUDIO);
    const result = await readMomentFacts(createNodeBundlesStore(root), {
      locales: ['be', 'en'],
      audioProbe: createNodeTeaserAudioProbe(root),
    });
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.moments[0]?.audioPath, 'bundles/route-a/1/en/base/audio/s-1.m4a');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('invalid_media_metadata_falls_back: a permission-denied media file is not playable (POSIX)', { skip: posixPermissionsSkip }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'g2202-probe-'));
  const denied = path.join(root, 'bundles', 'route-a', '1', 'be', 'base', 'audio', 's-1.m4a');
  try {
    writePackage(root, AUDIO, AUDIO);
    chmodSync(denied, 0o000);
    const result = await readMomentFacts(createNodeBundlesStore(root), {
      locales: ['be', 'en'],
      audioProbe: createNodeTeaserAudioProbe(root),
    });
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.moments[0]?.audioPath, 'bundles/route-a/1/en/base/audio/s-1.m4a');
  } finally {
    chmodSync(denied, 0o644);
    rmSync(root, { recursive: true, force: true });
  }
});

test('the probe answers the metadata negatives: missing, directory and empty never become a playable path', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'g2202-probe-'));
  try {
    writePackage(root, AUDIO, null);
    mkdirSync(path.join(root, 'bundles', 'route-a', '1', 'be', 'base', 'audio', 'dir.m4a'));
    writeFileSync(path.join(root, 'bundles', 'route-a', '1', 'en', 'base', 'audio', 'empty.m4a'), '');
    const probe = createNodeTeaserAudioProbe(root);
    assert.equal(await probe('bundles/route-a/1/be/base/audio/s-1.m4a'), true);
    assert.equal(await probe('bundles/route-a/1/be/base/audio/dir.m4a'), false);
    assert.equal(await probe('bundles/route-a/1/en/base/audio/empty.m4a'), false);
    assert.equal(await probe('bundles/route-a/1/be/base/audio/absent.m4a'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('metadata_probe_releases_handles: the bounded open closes on every path', { skip: fdCountSkip }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'g2202-probe-'));
  try {
    writePackage(root, AUDIO, null);
    mkdirSync(path.join(root, 'bundles', 'route-a', '1', 'be', 'base', 'audio', 'dir.m4a'));
    const probe = createNodeTeaserAudioProbe(root);
    const fdCount = (): number => readdirSync('/proc/self/fd').length;
    const before = fdCount();
    for (let i = 0; i < 25; i++) {
      assert.equal(await probe('bundles/route-a/1/be/base/audio/s-1.m4a'), true);
      assert.equal(await probe('bundles/route-a/1/be/base/audio/dir.m4a'), false);
      assert.equal(await probe('bundles/route-a/1/be/base/audio/absent.m4a'), false);
    }
    assert.ok(fdCount() <= before, 'the probe leaked file handles across paths');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

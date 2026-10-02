// G20.27 (#500) behavioral proof for tools/ci/fetch-gitleaks.mjs — the
// workflow-equivalent pipeline (spec §V6): every failure stage — missing
// checksum, HTTP failure, altered archive — answers nonzero (ok: false) with
// ZERO scanner executions, and only the genuine digest-pinned archive reaches
// extraction and execution. The scanner content is a fixture script that logs
// its own invocations, so "zero executions" is a fact about the filesystem,
// not about output text. All network input is injected via fetchImpl: the
// suite never touches the real release download.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { GITLEAKS_SHA256, GITLEAKS_VERSION, gitleaksArchiveUrl, runGitleaksPipeline } from './fetch-gitleaks.mjs';

const posixOnlySkip = process.platform === 'win32' ? 'the fixture scanner is a POSIX shell script' : undefined;

// A fixture archive whose `gitleaks` member appends one line of its own
// arguments per execution — the execution counter the negative cases count.
function makeArchive(sandboxDir) {
  const marker = path.join(sandboxDir, 'scanner-executions.log');
  writeFileSync(path.join(sandboxDir, 'gitleaks'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${marker}'\n`);
  chmodSync(path.join(sandboxDir, 'gitleaks'), 0o755);
  const archive = path.join(sandboxDir, 'scanner.tgz');
  const tar = spawnSync('tar', ['-czf', archive, '-C', sandboxDir, 'gitleaks'], { encoding: 'utf8' });
  assert.strictEqual(tar.status, 0, tar.stderr);
  return {
    archive,
    marker,
    digest: createHash('sha256').update(readFileSync(archive)).digest('hex'),
  };
}

function serveBytes(t, bytes, status = 200) {
  const server = http.createServer((request, response) => {
    response.statusCode = status;
    response.end(bytes);
  });
  t.after(() => server.close());
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/scanner.tgz`));
  });
}

function sandbox(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'kudy-gitleaks-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('the genuine pinned archive is extracted and the scanner runs exactly once with --redact', { skip: posixOnlySkip }, async (t) => {
  const dir = sandbox(t);
  const { archive, marker, digest } = makeArchive(dir);
  const url = await serveBytes(t, readFileSync(archive));
  const result = await runGitleaksPipeline({ url, expectedSha256: digest, sourceDir: dir });
  assert.strictEqual(result.ok, true, `${result.stage}: ${result.message}`);
  const executions = readFileSync(marker, 'utf8').trim().split('\n');
  assert.strictEqual(executions.length, 1, 'exactly one scanner execution');
  assert.match(executions[0], /--redact/, 'the scanner contract carries --redact — findings never print secrets');
});

test('an altered archive (digest mismatch) stops before extraction — zero scanner executions', { skip: posixOnlySkip }, async (t) => {
  const dir = sandbox(t);
  const { archive, marker, digest } = makeArchive(dir);
  const tampered = Buffer.concat([readFileSync(archive), Buffer.from('tampered')]);
  const url = await serveBytes(t, tampered);
  const result = await runGitleaksPipeline({ url, expectedSha256: digest, sourceDir: dir });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.stage, 'digest-mismatch');
  assert.ok(!existsSync(marker), 'the scanner never executed');
});

test('a missing pinned checksum fails closed before any download', async () => {
  let fetchCalled = false;
  const result = await runGitleaksPipeline({
    url: 'http://127.0.0.1:9/scanner.tgz',
    expectedSha256: '',
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error('fetch must not be reached');
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.stage, 'missing-checksum');
  assert.strictEqual(fetchCalled, false, 'nothing is downloaded without a pinned digest');
});

test('an HTTP failure stops the pipeline — zero scanner executions', { skip: posixOnlySkip }, async (t) => {
  const dir = sandbox(t);
  const { archive, marker } = makeArchive(dir);
  const url = await serveBytes(t, readFileSync(archive), 500);
  const result = await runGitleaksPipeline({ url, expectedSha256: createHash('sha256').update(readFileSync(archive)).digest('hex'), sourceDir: dir });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.stage, 'http');
  assert.ok(!existsSync(marker), 'the scanner never executed');
});

test('a filesystem failure answers a named staging failure with zero executions', async () => {
  let fetchCalled = false;
  const result = await runGitleaksPipeline({
    url: 'http://127.0.0.1:9/scanner.tgz',
    expectedSha256: GITLEAKS_SHA256,
    tmpRoot: path.join(tmpdir(), 'kudy-gitleaks-absent-root'),
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error('fetch must not be reached');
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.stage, 'staging');
  assert.match(result.message, /filesystem failure/);
  assert.strictEqual(fetchCalled, false, 'the temp directory is reserved before any download');
});

test('the committed pins are the single owner: a 64-hex digest and a URL derived from the version constant', () => {
  assert.match(GITLEAKS_SHA256, /^[0-9a-f]{64}$/);
  assert.match(GITLEAKS_VERSION, /^[0-9]+\.[0-9]+\.[0-9]+$/);
  assert.strictEqual(
    gitleaksArchiveUrl(),
    `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz`
  );
});

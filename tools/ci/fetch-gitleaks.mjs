// V6 (docs/specifications/architecture-hardening/verification-integration.md),
// G20.27 (issue #500): the secret scanner is downloaded over HTTPS only after
// its archive digest — pinned below from verified release provenance — matches
// the downloaded bytes. Verification happens BEFORE extraction and execution;
// a missing or wrong digest stops the job with a nonzero exit and zero scanner
// executions. The digest is never taken from the download itself or from the
// environment: the only production source is the committed constant, and the
// workflow wiring is pinned by tools/ci/check-required-checks.mjs.
// Update procedure (recorded in docs/agent-tasks/results/G20.27.md): bump
// GITLEAKS_VERSION, resolve the new archive sha256 from the release's
// checksums.txt AND an independent local sha256sum, set both constants in one
// commit, and let the fixture suite re-prove the four cases.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const GITLEAKS_VERSION = '8.24.3';
// sha256 of gitleaks_8.24.3_linux_x64.tar.gz, verified 2026-10-02 against the
// release's checksums.txt and an independent local sha256sum of the downloaded
// archive (docs/agent-tasks/results/G20.27.md carries both outputs).
export const GITLEAKS_SHA256 = '9991e0b2903da4c8f6122b5c3186448b927a5da4deef1fe45271c3793f4ee29c';

export function gitleaksArchiveUrl(version = GITLEAKS_VERSION) {
  return `https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_linux_x64.tar.gz`;
}

// The scanner must never print secrets into the job log: --redact is part of
// the executed contract, asserted by the fixture suite.
const SCANNER_ARGS = ['detect', '--source', '.', '--verbose', '--no-banner', '--redact'];

function fail(stage, message) {
  return { ok: false, stage, message };
}

// Workflow-equivalent pipeline: fetch → HTTP success check → sha256 → digest
// comparison → only then extraction → scanner execution. Any failure leaves
// the scanner untouched (executions 0) and cleans its temp directory.
export async function runGitleaksPipeline({
  url,
  expectedSha256,
  scannerArgs = SCANNER_ARGS,
  sourceDir = '.',
  fetchImpl = fetch,
  signal = AbortSignal.timeout(120000),
}) {
  if (!/^[0-9a-f]{64}$/.test(expectedSha256 ?? '')) {
    return fail('missing-checksum', 'no pinned 64-hex sha256 digest — refusing to download');
  }
  let workDir;
  try {
    let response;
    try {
      response = await fetchImpl(url, { signal });
    } catch (error) {
      return fail('http', `download failed: ${error.message}`);
    }
    if (!response.ok) {
      return fail('http', `HTTP ${response.status} for the scanner archive`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== expectedSha256) {
      return fail('digest-mismatch', `archive sha256 ${actual} does not match the pinned digest`);
    }
    workDir = await mkdtemp(path.join(tmpdir(), 'gitleaks-fetch-'));
    const archivePath = path.join(workDir, 'scanner.tgz');
    await writeFile(archivePath, bytes);
    const extract = spawnSync('tar', ['-xzf', archivePath, '-C', workDir, 'gitleaks'], {
      encoding: 'utf8',
    });
    if (extract.status !== 0) {
      return fail('extract', `tar exited ${extract.status}: ${extract.stderr ?? ''}`.trim());
    }
    const run = spawnSync(path.join(workDir, 'gitleaks'), scannerArgs, {
      encoding: 'utf8',
      cwd: sourceDir,
      stdio: 'inherit',
    });
    if (run.status !== 0) {
      return fail('scanner', `scanner exited ${run.status}`);
    }
    return { ok: true };
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  }
}

async function main() {
  const result = await runGitleaksPipeline({
    url: gitleaksArchiveUrl(),
    expectedSha256: GITLEAKS_SHA256,
    sourceDir: process.cwd(),
  });
  if (!result.ok) {
    console.error(`gitleaks-fetch: FAIL at ${result.stage}: ${result.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`gitleaks-fetch: OK — gitleaks ${GITLEAKS_VERSION} digest verified before execution`);
}

// Importing this module must never start a download: only a direct invocation
// runs the pipeline (the deno-typecheck.mjs idiom).
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}

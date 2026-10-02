// G19.01/G19.02 — corpus CLI: local contract validation and package import.
// Commands from the plan's G19.01/G19.02 rows:
//   validate-input --manifest PATH
//   validate-run   --config PATH
//   unpack --manifest PATH --input-root PATH --library-root PATH
//          [--extractor-version V]        (default: wiki-html/v1)
// validate-* read the one JSON document named on the command line and answer
// with stable diagnostics; unpack additionally walks the manifest records
// and imports each into the library root through importArticle — the only
// filesystem objects touched are the manifest document and the roots passed
// explicitly. No network call is made at any point (25 §3): the extraction
// profile opens its browser context with JavaScript disabled and every
// request aborted. Exit codes follow the collector CLI: 0 ok, 1 contract
// diagnostics, 2 usage/file error.

import { mkdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { validateInput, validateRunConfig } from './contracts.mjs';
import { CorpusDiagnostic, createExtractionBrowserFactory } from './extract.mjs';
import { importArticle } from './import.mjs';

const usage = `usage: node tools/corpus/cli.mjs validate-input --manifest PATH
       node tools/corpus/cli.mjs validate-run --config PATH
       node tools/corpus/cli.mjs unpack --manifest PATH --input-root PATH --library-root PATH [--extractor-version V]`;

function fail(message, code) {
  console.error(`corpus: ${message}`);
  process.exit(code);
}

function parseArgs(args) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;
    if (i + 1 >= args.length) fail(`${arg} requires a value`, 2);
    values[arg.slice(2)] = args[i + 1];
    i += 1;
  }
  return values;
}

function readJsonDocument(kind, file) {
  let raw;
  try {
    raw = readFileSync(path.resolve(file), 'utf8');
  } catch {
    fail(`cannot read ${kind} file ${file}`, 2);
  }
  try {
    return JSON.parse(raw);
  } catch {
    fail(`${kind} file is not valid JSON`, 2);
  }
}

function printDiagnostics(kind, errors) {
  console.error(`corpus: ${kind} invalid (${errors.length} diagnostic(s))`);
  for (const error of errors) console.error(`  ${error.rule} at ${error.path}`);
}

function countRecords(manifest) {
  return Array.isArray(manifest.records) ? manifest.records.length : 0;
}

function countMedia(manifest) {
  if (!Array.isArray(manifest.records)) return 0;
  return manifest.records.reduce((total, record) => total + (Array.isArray(record?.media) ? record.media.length : 0), 0);
}

// unpack: manifest-level contract first, then per-record import. One failed
// record does not stop the others; the summary and the exit code reflect
// every failure. Output carries record indexes, id prefixes and rule names
// only — source keys, site addresses and local paths are private data
// (25 §9), so CorpusDiagnostic messages never reach the journal here.
async function unpackCommand(parsed) {
  if (!parsed.manifest || !parsed['input-root'] || !parsed['library-root']) {
    fail('unpack requires --manifest, --input-root and --library-root', 2);
  }
  const manifest = readJsonDocument('manifest', parsed.manifest);
  const verdict = validateInput(manifest);
  if (!verdict.ok) {
    printDiagnostics('manifest', verdict.errors);
    process.exit(1);
  }
  const inputRoot = path.resolve(parsed['input-root']);
  const libraryRoot = path.resolve(parsed['library-root']);
  mkdirSync(libraryRoot, { recursive: true });
  const extractorVersion = parsed['extractor-version'] ?? 'wiki-html/v1';

  const factory = await createExtractionBrowserFactory();
  let failed = 0;
  try {
    for (const [index, record] of manifest.records.entries()) {
      try {
        const pkg = await importArticle(record, {
          inputRoot,
          libraryRoot,
          sourceNamespace: manifest.source_namespace,
          extractorVersion,
          browserFactory: factory,
        });
        // An already-present package is not re-measured, so its line carries
        // no media/missing counts — those would be stale, not recomputed.
        const tail = pkg.alreadyPresent ? '' : `, ${pkg.media.length} media file(s), ${pkg.missing.length} missing original(s)`;
        console.log(
          `corpus: record[${index}] ${pkg.alreadyPresent ? 'already-present' : 'imported'} — article ${pkg.articleId.slice(0, 12)} revision ${pkg.revisionId.slice(0, 12)}${tail}`
        );
      } catch (error) {
        failed += 1;
        if (error instanceof CorpusDiagnostic) {
          console.error(`corpus: record[${index}] ${error.rule}`);
        } else {
          // OS-level messages embed full paths — name the error class only.
          console.error(`corpus: record[${index}] unexpected ${error.name ?? 'error'}`);
        }
      }
    }
  } finally {
    await factory.close();
  }
  console.log(`corpus: unpack finished — ${manifest.records.length - failed} ok, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

async function main(args) {
  const [command, ...rest] = args;

  if (command === 'validate-input') {
    const parsed = parseArgs(rest);
    if (!parsed.manifest) fail('validate-input requires --manifest', 2);
    const manifest = readJsonDocument('manifest', parsed.manifest);
    const verdict = validateInput(manifest);
    if (!verdict.ok) {
      printDiagnostics('manifest', verdict.errors);
      process.exit(1);
    }
    console.log(`corpus: manifest ok — ${countRecords(manifest)} record(s), ${countMedia(manifest)} media file(s)`);
    return;
  }

  if (command === 'validate-run') {
    const parsed = parseArgs(rest);
    if (!parsed.config) fail('validate-run requires --config', 2);
    const config = readJsonDocument('run config', parsed.config);
    const verdict = validateRunConfig(config);
    if (!verdict.ok) {
      printDiagnostics('run config', verdict.errors);
      process.exit(1);
    }
    console.log(`corpus: run config ok — level ${config.level}, ${config.mode}`);
    return;
  }

  if (command === 'unpack') {
    await unpackCommand(parseArgs(rest));
    return;
  }

  console.error(usage);
  fail(`unknown command '${command ?? ''}'`, 2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    // Journal hygiene (25 §6/§9): the rule or error class only — messages
    // may embed local paths and private keys.
    console.error(`corpus: ${error instanceof CorpusDiagnostic ? error.rule : error.name ?? 'error'}`);
    process.exit(1);
  });
}

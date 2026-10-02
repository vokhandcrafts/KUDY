// G19.01 — corpus CLI: local contract validation (issue #458).
// Two commands from the plan's G19.01 row:
//   validate-input --manifest PATH
//   validate-run   --config PATH
// Each reads the one JSON document named on the command line and answers
// with stable diagnostics; no filesystem object beyond that document is
// touched and no model call is made — referenced files are checked at
// unpack (G19.02), the model boundary is G19.04. Exit codes follow the
// collector CLI: 0 valid, 1 contract diagnostics, 2 usage/file error.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { validateInput, validateRunConfig } from './contracts.mjs';

const usage = `usage: node tools/corpus/cli.mjs validate-input --manifest PATH
       node tools/corpus/cli.mjs validate-run --config PATH`;

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

function main(args) {
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

  console.error(usage);
  fail(`unknown command '${command ?? ''}'`, 2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}

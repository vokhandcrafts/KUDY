#!/usr/bin/env node
// Collector CLI (G17.01.a): init / run --campaign <file> / status.
// Local, manual, offline — no network fetching happens in v0. Exit codes:
// 0 ok; 1 invalid campaign (diagnostics on stderr); 2 usage or file errors.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseCampaign } from './campaign.mjs';
import { countRows, openStore, sha256Hex, stepStatusCounts } from './store.mjs';
import { runCampaign } from './runloop.mjs';

const usage = `usage: node tools/collector/collector.mjs <command> [options]

commands:
  init                                create the schema in the database
  run --campaign <file>               validate, register and process a campaign
  status                              print stored counts

options:
  --db <path>    database file (default: tools/collector/runtime/collector.sqlite)`;

const defaultDbPath = fileURLToPath(new URL('./runtime/collector.sqlite', import.meta.url));

function fail(message, code) {
  console.error(`collector: ${message}`);
  process.exit(code);
}

// Corrupt or unusable --db paths (an existing directory, an unwritable
// location) answer with a diagnostic and exit 2, never a thrown SqliteError.
function openStoreOrExit(dbPath) {
  try {
    return openStore(dbPath);
  } catch (error) {
    fail(`cannot open database ${dbPath}: ${error.message}`, 2);
  }
}

export function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        db: { type: 'string' },
        campaign: { type: 'string' },
      },
      args: argv,
    });
  } catch (error) {
    console.error(usage);
    fail(error.message, 2);
  }
  const [command] = parsed.positionals;
  if (!command || !['init', 'run', 'status'].includes(command)) {
    console.error(usage);
    fail(`unknown command '${command ?? ''}'`, 2);
  }
  const dbPath = path.resolve(parsed.values.db ?? defaultDbPath);

  if (command === 'init') {
    openStoreOrExit(dbPath);
    console.log(`collector: schema ready at ${dbPath}`);
    return;
  }

  if (command === 'run') {
    if (!parsed.values.campaign) {
      console.error(usage);
      fail('run requires --campaign <file>', 2);
    }
    const file = path.resolve(parsed.values.campaign);
    let source;
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch (error) {
      fail(`cannot read campaign file ${file}: ${error.message}`, 2);
    }
    const result = parseCampaign(source);
    if (!result.ok) {
      for (const diagnostic of result.diagnostics) console.error(`collector: ${diagnostic}`);
      process.exit(1);
    }
    const db = openStoreOrExit(dbPath);
    const run = runCampaign(db, result.campaign, {
      sourcePath: file,
      contentHash: sha256Hex(source),
    });
    const steps = stepStatusCounts(db, run.campaignId);
    console.log(
      `collector: campaign ${result.campaign.city} (${run.campaignId.slice(0, 12)}) — ` +
        `steps done ${run.done}, failed ${run.failed}, running ${steps.running ?? 0}, pending ${steps.pending ?? 0}`
    );
    console.log(`collector: raw_records total ${countRows(db, 'raw_records', run.campaignId)}`);
    return;
  }

  if (!fs.existsSync(dbPath)) {
    fail(`database file does not exist: ${dbPath} — run init or run first`, 2);
  }
  const db = openStoreOrExit(dbPath);
  const steps = stepStatusCounts(db);
  console.log(`collector: db ${dbPath}`);
  console.log(`campaigns: ${countRows(db, 'campaigns')}`);
  console.log(`raw_records: ${countRows(db, 'raw_records')}`);
  console.log(
    `run_log: done ${steps.done ?? 0}, running ${steps.running ?? 0}, pending ${steps.pending ?? 0}, failed ${steps.failed ?? 0}`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}

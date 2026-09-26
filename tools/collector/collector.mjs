#!/usr/bin/env node
// Collector CLI (G17.01.a; network crawl — G17.02; cleaning — G17.06; library
// search, basket and draft export — G17.07): init / run --campaign <file> /
// clean --campaign <file> / export-review --campaign <file> / search /
// basket / export-draft / status. Local, manual. A `run` over http(s) seeds
// crawls live through the fence; file:// seeds stay the offline fixture path.
// Exit codes: 0 ok; 1 invalid campaign or a campaign command on a campaign
// that was never run, an empty basket (diagnostics on stderr); 2 usage or
// file errors. A run stopped by the crawler's error series reports the
// diagnostic on stderr and still exits 0 — the queue state in run_log is the
// resume point.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseCampaign } from './campaign.mjs';
import {
  basketAdd,
  basketClear,
  basketIds,
  countRows,
  countSnapshots,
  getRawRecord,
  latestCleanedVersion,
  openStore,
  registeredCampaignId,
  sha256Hex,
  stepStatusCounts,
} from './store.mjs';
import { runCampaign } from './runloop.mjs';
import { cleanCampaign } from './clean.mjs';
import { exportReviewBundle } from './review.mjs';
import { basketRows, exportDraft, searchLibrary } from './library.mjs';

const usage = `usage: node tools/collector/collector.mjs <command> [options]

commands:
  init                                create the schema in the database
  run --campaign <file>               validate, register and process a campaign
  clean --campaign <file>             clean raw records into versioned documents
  export-review --campaign <file>     export cleaned documents as a review bundle
  search [--city C] [--topic T] [--type K] [--query Q]
                                      find library records; K is news|wiki|web|youtube,
                                      Q is full text over the latest cleaned documents
  basket add --record <id> [--record <id> ...] | basket list | basket clear
                                      collect fragments for the draft export
  export-draft --out <file>           write the markdown draft from the basket;
                                      exported records move cleaned -> used
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

// main is async: the crawl (G17.02) and wiki (G17.04) handlers await their
// transports, so the run command awaits the campaign loop. The CLI guard below
// converts a rejected run into the exit-2 diagnostic path.
// The campaign commands' shared preamble: read the file (exit 2 on a file
// error), parse and validate it (exit 1 with the schema diagnostics).
function readCampaignOrExit(file) {
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
  return { source, campaign: result.campaign };
}

// clean / export-review work on a campaign the store already knows (cleaning
// needs the collected raw records): the campaign file is validated like in
// run, but its identity is looked up without inserting — a never-run campaign
// answers with a diagnostic (exit 1), not a phantom row.
function registeredCampaignOrExit(db, file) {
  const campaignId = registeredCampaignId(db, file);
  if (!campaignId) fail(`campaign file is not registered — run it first: ${file}`, 1);
  return campaignId;
}

export async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        db: { type: 'string' },
        campaign: { type: 'string' },
        city: { type: 'string' },
        topic: { type: 'string' },
        type: { type: 'string' },
        query: { type: 'string' },
        record: { type: 'string', multiple: true },
        out: { type: 'string' },
      },
      args: argv,
    });
  } catch (error) {
    console.error(usage);
    fail(error.message, 2);
  }
  const [command] = parsed.positionals;
  if (!command || !['init', 'run', 'status', 'clean', 'export-review', 'search', 'basket', 'export-draft'].includes(command)) {
    console.error(usage);
    fail(`unknown command '${command ?? ''}'`, 2);
  }
  const dbPath = path.resolve(parsed.values.db ?? defaultDbPath);
  const requireDb = () => {
    if (!fs.existsSync(dbPath)) fail(`database file does not exist: ${dbPath} — run init or run first`, 2);
  };

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
    const { source, campaign } = readCampaignOrExit(file);
    const db = openStoreOrExit(dbPath);
    // Snapshots live next to the database, one campaign subdir per db.
    const snapshotsRoot = path.join(path.dirname(dbPath), 'snapshots');
    const run = await runCampaign(db, campaign, {
      sourcePath: file,
      contentHash: sha256Hex(source),
      snapshotsRoot,
    });
    if (run.stopped) console.error(`collector: run stopped — ${run.stopped}`);
    const steps = stepStatusCounts(db, run.campaignId);
    console.log(
      `collector: campaign ${campaign.city} (${run.campaignId.slice(0, 12)}) — ` +
        `steps done ${run.done}, failed ${run.failed}, running ${steps.running ?? 0}, pending ${steps.pending ?? 0}`
    );
    console.log(`collector: raw_records total ${countRows(db, 'raw_records', run.campaignId)}`);
    console.log(`collector: snapshots root ${snapshotsRoot}`);
    return;
  }

  if (command === 'clean' || command === 'export-review') {
    if (!parsed.values.campaign) {
      console.error(usage);
      fail(`${command} requires --campaign <file>`, 2);
    }
    const file = path.resolve(parsed.values.campaign);
    const { campaign } = readCampaignOrExit(file);
    const db = openStoreOrExit(dbPath);
    const campaignId = registeredCampaignOrExit(db, file);

    if (command === 'clean') {
      const counts = cleanCampaign(db, campaignId);
      console.log(
        `collector: clean ${campaign.city} (${campaignId.slice(0, 12)}) — ` +
          `eligible ${counts.eligible}, versions written ${counts.written}, unchanged ${counts.unchanged}, ` +
          `failed ${counts.failed}, skipped (failed earlier) ${counts.skippedFailed}`
      );
      return;
    }
    const reviewDir = path.join(path.dirname(dbPath), 'snapshots', campaignId.slice(0, 12), 'review');
    const { entries } = exportReviewBundle(db, campaignId, { reviewDir });
    console.log(`collector: review bundle at ${reviewDir} (${entries.length} document(s))`);
    return;
  }

  // Library commands (G17.07) work on the whole database — the spec's
  // single-library model: no campaign flag, filters are passport fields.
  if (command === 'search') {
    requireDb();
    const type = parsed.values.type;
    if (type && !['news', 'wiki', 'web', 'youtube'].includes(type)) {
      fail(`unknown source type '${type}' — one of: news, wiki, web, youtube`, 2);
    }
    const db = openStoreOrExit(dbPath);
    const query = parsed.values.query?.trim() ? parsed.values.query : undefined;
    const hits = searchLibrary(db, {
      city: parsed.values.city,
      topic: parsed.values.topic,
      type,
      query,
    });
    for (const hit of hits) {
      console.log(`${hit.id}  ${hit.city}  ${hit.source_type}  ${hit.status}  ${hit.title ?? hit.url} — ${hit.url}`);
    }
    console.log(`collector: ${hits.length} record(s)`);
    return;
  }

  if (command === 'basket') {
    const [action] = parsed.positionals.slice(1);
    if (!['add', 'list', 'clear'].includes(action ?? '')) {
      console.error(usage);
      fail("basket requires an action: add --record <id> | list | clear", 2);
    }
    requireDb();
    const db = openStoreOrExit(dbPath);
    if (action === 'add') {
      const records = parsed.values.record ?? [];
      if (records.length === 0) {
        console.error(usage);
        fail('basket add requires --record <id>', 2);
      }
      // Validate every id before adding anything: a bad batch adds nothing,
      // not a prefix.
      for (const id of records) {
        if (!getRawRecord(db, id)) fail(`no such record: ${id}`, 1);
        if (!latestCleanedVersion(db, id)) fail(`record ${id} has no cleaned document — run clean first`, 1);
      }
      const now = new Date().toISOString();
      const added = records.filter((id) => basketAdd(db, id, now)).length;
      console.log(`collector: basket — added ${added}, already in basket ${records.length - added}`);
      return;
    }
    if (action === 'list') {
      const rows = basketRows(db);
      for (const row of rows) {
        console.log(`${row.id}  added ${row.added_at}  ${row.city}  ${row.source_type}  ${row.title ?? row.url} — ${row.url}`);
      }
      console.log(`collector: basket holds ${rows.length} record(s)`);
      return;
    }
    const cleared = basketClear(db);
    console.log(`collector: basket cleared (${cleared} record(s) removed)`);
    return;
  }

  if (command === 'export-draft') {
    if (!parsed.values.out) {
      console.error(usage);
      fail('export-draft requires --out <file>', 2);
    }
    requireDb();
    const db = openStoreOrExit(dbPath);
    if (basketIds(db).length === 0) fail('basket is empty — add fragments with `basket add` first', 1);
    const outPath = path.resolve(parsed.values.out);
    const result = exportDraft(db, { outPath });
    console.log(`collector: draft at ${outPath} — ${result.fragments} fragment(s), ${result.transitioned} moved to used`);
    return;
  }

  requireDb();
  const db = openStoreOrExit(dbPath);
  const steps = stepStatusCounts(db);
  console.log(`collector: db ${dbPath}`);
  console.log(`campaigns: ${countRows(db, 'campaigns')}`);
  console.log(`raw_records: ${countRows(db, 'raw_records')}`);
  console.log(`snapshots: ${countSnapshots(db)}`);
  console.log(
    `run_log: done ${steps.done ?? 0}, running ${steps.running ?? 0}, pending ${steps.pending ?? 0}, failed ${steps.failed ?? 0}`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => fail(String(error?.message ?? error), 2));
}

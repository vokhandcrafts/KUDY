// Cleaning engine (G17.06): turns a raw snapshot into a versioned cleaned
// document (docs/24_web_collection.md «Ачыстка»). The raw record is never
// rewritten — a cleaning run whose package version differs from the latest
// writes the next `cleaned/v<N>.md` beside the raw files; re-running the same
// package version is a no-op, so re-runs converge instead of duplicating
// (a deliberately different package version is the rollback path: bad rules
// are undone by re-running with the good one).
//
// Pipeline order per the spec: main-content extraction → strip nav/ads/
// «прачытайце таксама» → anchor and photo normalization → date and language.
// The first step already happened at snapshot time (extract.mjs wrote
// text.md), so the engine prunes non-content paragraphs with the package's
// rules and preserves the rest byte-for-byte: anchors stay in their
// [label](url) form and media blocks stay at their positions with captions.
// Date and language move into the document's front matter from metadata.json.
//
// Every cleaning step is a run_log row (kind 'clean') whose work order and
// completion note name the package version — the log is the audit trail the
// acceptance criteria quote.
import fs from 'node:fs';
import path from 'node:path';
import { PACKAGES, packageForType, packageName } from './packages.mjs';
import {
  claimStep,
  claimableSteps,
  completeStep,
  enqueueStep,
  failStep,
  getRawRecord,
  insertCleanedVersion,
  latestCleanedVersion,
  markRecordCleaned,
  recordsToClean,
  sha256Hex,
} from './store.mjs';

// text.md / transcript.md block model: paragraphs separated by a blank line;
// a block starting with `![` is a media block (media.mjs's markdown, caption
// emphasis line included) and is preserved verbatim — rules never touch it.
export function parseRawBlocks(text) {
  const blocks = [];
  for (const raw of text.split(/\n\n+/)) {
    const block = raw.replace(/\s+$/, '');
    if (block === '') continue;
    blocks.push({ kind: block.startsWith('![') ? 'media' : 'paragraph', text: block });
  }
  return blocks;
}

export function applyPackage(blocks, pkg) {
  const kept = [];
  let dropped = 0;
  let stripped = 0;
  for (const block of blocks) {
    if (block.kind === 'media') {
      kept.push(block);
      continue;
    }
    if (pkg.drop.some((pattern) => pattern.test(block.text))) {
      dropped += 1;
      continue;
    }
    let text = block.text;
    for (const pattern of pkg.strip ?? []) text = text.replace(pattern, '');
    if (text.trim() === '') {
      dropped += 1; // a strip rule emptied the paragraph — nothing left to keep
      continue;
    }
    if (text !== block.text) stripped += 1;
    kept.push({ kind: 'paragraph', text });
  }
  return { blocks: kept, dropped, stripped };
}

// The YouTube passport stores upload_date as YYYYMMDD (metadata.json contract,
// youtube.mjs); the cleaned document's published_at is the ISO date. The
// mapping is declared once here.
function publishedAt(metadata) {
  const match = typeof metadata.upload_date === 'string' ? metadata.upload_date.match(/^(\d{4})(\d{2})(\d{2})$/) : null;
  return match ? `${match[1]}-${match[2]}-${match[3]}` : (metadata.published_at ?? null);
}

function buildCleanedDocument({ record, metadata, blocks, pkg }) {
  const frontMatter = [
    '---',
    `record: ${record.id}`,
    `url: ${record.url}`,
    `type: ${record.source_type}`,
    `package: ${packageName(pkg)}`,
    `title: ${metadata.title ?? 'null'}`,
    `published_at: ${publishedAt(metadata) ?? 'null'}`,
    `language: ${metadata.language ?? 'null'}`,
    '---',
    '',
  ];
  return frontMatter.concat(blocks.map((block) => block.text), '').join('\n');
}

// One record, one package: read the raw snapshot, apply the package, write the
// next version (or none when the latest version already carries this package
// version). Throws a named diagnostic on unreadable or corrupt input — the
// step fails, the run continues.
export function cleanRecord(db, record, pkg, { now }) {
  const rawName = record.source_type === 'youtube' ? 'transcript.md' : 'text.md';
  let rawBytes;
  try {
    rawBytes = fs.readFileSync(path.join(record.snapshot_path, rawName));
  } catch (error) {
    throw new Error(`clean ${record.url}: cannot read ${rawName} — ${error.message}`);
  }
  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(path.join(record.snapshot_path, 'metadata.json'), 'utf8'));
  } catch (error) {
    throw new Error(`clean ${record.url}: cannot read metadata.json — ${error.message}`);
  }
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error(`clean ${record.url}: metadata.json must hold an object`);
  }

  const { blocks } = applyPackage(parseRawBlocks(rawBytes.toString('utf8')), pkg);
  if (blocks.length === 0) {
    throw new Error(`clean ${record.url}: the rules drop every block — refusing to write an empty document`);
  }
  const document = Buffer.from(buildCleanedDocument({ record, metadata, blocks, pkg }), 'utf8');

  const latest = latestCleanedVersion(db, record.id);
  if (latest && latest.package === pkg.name && latest.package_version === pkg.version) {
    return {
      outcome: 'unchanged',
      version: latest.version,
      note: `package ${packageName(pkg)}: latest version ${latest.version} stands — nothing written`,
    };
  }
  const version = (latest?.version ?? 0) + 1;
  const cleanedDir = path.join(record.snapshot_path, 'cleaned');
  fs.mkdirSync(cleanedDir, { recursive: true });
  const filePath = path.join(cleanedDir, `v${version}.md`);
  fs.writeFileSync(filePath, document);
  insertCleanedVersion(db, {
    rawRecordId: record.id,
    version,
    package: pkg.name,
    packageVersion: pkg.version,
    contentHash: sha256Hex(document),
    path: filePath,
    createdAt: now,
  });
  markRecordCleaned(db, record.id);
  return { outcome: 'written', version, note: `package ${packageName(pkg)}: wrote version ${version}` };
}

// The run-loop step handler: the work order (detail JSON) carries the record
// id; the package always resolves from the current registry against the
// record's own source type.
export function processCleanStep(db, step, { now, packages = PACKAGES } = {}) {
  let order;
  try {
    order = JSON.parse(step.detail ?? '{}');
  } catch {
    throw new Error(`clean step '${step.ref}': unreadable work order`);
  }
  if (!order.recordId) throw new Error(`clean step '${step.ref}': work order without recordId`);
  const record = getRawRecord(db, order.recordId);
  if (!record) throw new Error(`clean step '${step.ref}': record ${order.recordId} not found`);
  return cleanRecord(db, record, packageForType(record.source_type, packages), { now });
}

// A cleaning pass over one campaign: enqueue one step per record a new
// version would be written for, then drain the queue. The step ref carries
// the target version (`<record>:<package>#v<N>`), so a re-run after a rule
// bump — including the rollback re-run of an older package version —
// enqueues a fresh attempt, while a record whose latest version already
// carries the current package version enqueues nothing. Cleaning enqueues
// nothing new, so one drain pass ends it; a step left 'running' by an
// interrupted process is claimed again — resume, not restart (a step that
// wrote its version but died before completing converges on the 'unchanged'
// outcome). Non-clean steps keep their own resume point: they stay pending
// here even if collection never finished.
export function cleanCampaign(db, campaignId, { now = new Date().toISOString(), packages = PACKAGES } = {}) {
  const records = recordsToClean(db, campaignId);
  for (const record of records) {
    const pkg = packageForType(record.source_type, packages);
    const latest = latestCleanedVersion(db, record.id);
    if (latest && latest.package === pkg.name && latest.package_version === pkg.version) continue;
    const target = (latest?.version ?? 0) + 1;
    enqueueStep(db, campaignId, 'clean', `${record.id}:${packageName(pkg)}#v${target}`, now, JSON.stringify({
      recordId: record.id,
      package: pkg.name,
      package_version: pkg.version,
      target_version: target,
    }));
  }
  const counts = { eligible: records.length, written: 0, unchanged: 0, failed: 0, skippedFailed: 0 };
  // A failed clean step is terminal, like every collection step: a re-run
  // enqueues nothing for it (the same ref conflicts) and claimableSteps only
  // serves pending/running. Records whose LATEST clean step is failed are
  // counted after the enqueuing, so the skip stays visible (`skipped (failed
  // earlier)`) — while a record that just got a fresh attempt (the recovery
  // path: a new package version after fixing the cause) is superseded by its
  // new step and is not counted.
  counts.skippedFailed = Number(
    db.prepare(
      `SELECT COUNT(*) AS n FROM run_log r
       WHERE r.campaign_id = ? AND r.kind = 'clean' AND r.status = 'failed'
         AND r.id = (SELECT MAX(l.id) FROM run_log l
                     WHERE l.campaign_id = r.campaign_id AND l.kind = 'clean'
                       AND substr(l.ref, 1, instr(l.ref, ':') - 1) = substr(r.ref, 1, instr(r.ref, ':') - 1))`
    ).get(campaignId).n
  );
  for (const step of claimableSteps(db, campaignId)) {
    if (step.kind !== 'clean') continue;
    claimStep(db, step.id, now);
    try {
      const result = processCleanStep(db, step, { now, packages });
      // The note is appended to the work-order detail, never replaces it —
      // the same contract as the run loop (runloop.mjs).
      completeStep(db, step.id, now, step.detail ? `${step.detail} | ${result.note}` : result.note);
      counts[result.outcome] += 1;
    } catch (error) {
      failStep(db, step.id, error instanceof Error ? error.message : String(error), now);
      counts.failed += 1;
    }
  }
  return counts;
}

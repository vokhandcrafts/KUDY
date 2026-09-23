// Run loop (G17.01.a): register the campaign, enqueue its work items, execute
// claimable steps, record progress in run_log. Idempotent by construction —
// enqueuing and record registration use ON CONFLICT DO NOTHING, and steps
// already 'done' are never re-executed. A row left 'running' by an interrupted
// process is claimed again by the next run: resume, not restart.
//
// v0 fetches nothing (network collectors are G17.02+). The default seed
// handler processes only pages a loader hands it: by default file:// seeds are
// read from disk — the local fixture boundary for the snapshot pipeline
// (G17.01.b) — and every other scheme answers null, so the seed stays
// progress-only, exactly as in G17.01.a. The default youtube handler registers
// the record shell so the library row exists before G17.05 fills it; rights
// per docs/24_web_collection.md — YouTube transcripts are research_only.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  claimStep,
  claimableSteps,
  completeStep,
  enqueueStep,
  ensureCampaign,
  failStep,
  upsertRawRecord,
} from './store.mjs';
import { defaultSnapshotsRoot, processFetchedPage } from './snapshot.mjs';

// The page-source boundary: tests and demos run the full snapshot pipeline
// from local fixtures; G17.02 replaces this loader with the real fetcher.
function defaultLoadPage(url) {
  if (new URL(url).protocol !== 'file:') return null;
  return fs.readFileSync(fileURLToPath(url), 'utf8');
}

export function defaultHandlers({ loadPage = defaultLoadPage } = {}) {
  return {
    seed(ctx, step) {
      let html;
      try {
        html = loadPage(step.ref);
      } catch (error) {
        throw new Error(`seed ${step.ref}: ${error.message}`);
      }
      if (html === null) return; // no page source for this scheme: progress only
      try {
        processFetchedPage(ctx.db, ctx.campaign, ctx.campaignId, {
          url: step.ref,
          html,
          now: ctx.now,
          snapshotsRoot: ctx.snapshotsRoot,
        });
      } catch (error) {
        throw new Error(`seed ${step.ref}: ${error.message}`);
      }
    },
    youtube({ db, campaign, campaignId, now }, step) {
      const url = `https://www.youtube.com/watch?v=${step.ref}`;
      upsertRawRecord(db, {
        id: randomUUID(),
        campaign_id: campaignId,
        source_type: 'youtube',
        url,
        canonical_url: url,
        collected_at: now,
        city: campaign.city,
        topics: JSON.stringify(campaign.topics),
        rights: 'research_only',
        content_hash: null,
        status: 'raw',
        snapshot_path: null,
        media_dir: null,
      });
    },
  };
}

export function runCampaign(
  db,
  campaign,
  { sourcePath, contentHash, handlers = defaultHandlers(), snapshotsRoot = defaultSnapshotsRoot() } = {}
) {
  const { campaignId } = ensureCampaign(db, { campaign, sourcePath, contentHash });
  const now = new Date().toISOString();
  for (const ref of campaign.youtube) enqueueStep(db, campaignId, 'youtube', ref, now);
  for (const url of campaign.seeds) enqueueStep(db, campaignId, 'seed', url, now);

  const counts = { campaignId, done: 0, failed: 0 };
  const ctx = { db, campaign, campaignId, now, snapshotsRoot };
  for (const step of claimableSteps(db, campaignId)) {
    const handler = handlers[step.kind];
    claimStep(db, step.id, now);
    if (!handler) {
      failStep(db, step.id, `no handler for step kind '${step.kind}'`, now);
      counts.failed += 1;
      continue;
    }
    try {
      handler(ctx, step);
      completeStep(db, step.id, now);
      counts.done += 1;
    } catch (error) {
      failStep(db, step.id, error instanceof Error ? error.message : String(error), now);
      counts.failed += 1;
    }
  }
  return counts;
}

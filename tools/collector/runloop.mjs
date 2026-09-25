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
import { processImageStep } from './media.mjs';
import { defaultSnapshotsRoot, processFetchedPage } from './snapshot.mjs';

// The page-source boundary: tests and demos run the full snapshot pipeline
// from local fixtures; G17.02 replaces this loader with the real fetcher.
function defaultLoadPage(url) {
  if (new URL(url).protocol !== 'file:') return null;
  return fs.readFileSync(fileURLToPath(url), 'utf8');
}

// The image-source boundary (G17.03): same rule as the page loader — file://
// fixtures only, every other scheme answers null (the image step turns that
// into a failed-step diagnostic). Returns bytes, not text.
function defaultLoadImage(url) {
  if (new URL(url).protocol !== 'file:') return null;
  return fs.readFileSync(fileURLToPath(url));
}

export function defaultHandlers({ loadPage = defaultLoadPage, loadImage = defaultLoadImage } = {}) {
  return {
    loadImage,
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
    image(ctx, step) {
      // The diagnostic already names the source URL and the reason.
      return processImageStep(ctx.db, { now: ctx.now, loadImage: ctx.loadImage }, step);
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
  const ctx = { db, campaign, campaignId, now, snapshotsRoot, loadImage: handlers.loadImage };
  // The loop drains: a seed handler enqueues its image steps mid-run, so the
  // claimable list is re-read until nothing is left — one invocation finishes
  // the whole campaign. Every processed step ends 'done' or 'failed', so the
  // drain terminates.
  for (;;) {
    const steps = claimableSteps(db, campaignId);
    if (steps.length === 0) break;
    for (const step of steps) {
      const handler = handlers[step.kind];
      claimStep(db, step.id, now);
      if (!handler) {
        failStep(db, step.id, `no handler for step kind '${step.kind}'`, now);
        counts.failed += 1;
        continue;
      }
      try {
        // A step may answer an outcome note (the image step's skip message).
        // It is appended to the work-order detail, never replaces it — the
        // detail is what a resumed process re-reads.
        const note = handler(ctx, step);
        completeStep(
          db,
          step.id,
          now,
          typeof note === 'string' && note !== '' ? (step.detail ? `${step.detail} | ${note}` : note) : null
        );
        counts.done += 1;
      } catch (error) {
        failStep(db, step.id, error instanceof Error ? error.message : String(error), now);
        counts.failed += 1;
      }
    }
  }
  return counts;
}

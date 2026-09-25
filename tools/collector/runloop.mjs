// Run loop (G17.01.a): register the campaign, enqueue its work items, execute
// claimable steps, record progress in run_log. Idempotent by construction —
// enqueuing and record registration use ON CONFLICT DO NOTHING, and steps
// already 'done' are never re-executed. A row left 'running' by an interrupted
// process is claimed again by the next run: resume, not restart.
//
// G17.02 turns the loop async (the crawl pipeline politeness-delays between
// requests) and adds the network crawl: http(s) seeds and every discovered
// 'crawl' step walk through the fence-audited crawler (crawler.mjs) into the
// G17.01.b snapshot writer. file:// seeds keep the G17.01.b fixture boundary —
// read from disk by the default loader, no fence, no network — and every other
// scheme stays progress-only, exactly as in G17.01.a. The default youtube
// handler registers the record shell so the library row exists before G17.05
// fills it; rights per docs/24_web_collection.md — YouTube transcripts are
// research_only.
//
// A CrawlStopError (error series, crawler.mjs) stops the whole run: the step
// is marked failed with the diagnostic, the remaining queue stays untouched,
// and runCampaign reports `stopped` so the CLI can surface it.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
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
import { CrawlStopError, createCrawler, parseCrawlDetail } from './crawler.mjs';
import { createBrowserFetchPage } from './netfetch.mjs';

// The page-source boundary: tests and demos run the full snapshot pipeline
// from local fixtures; the network crawl (G17.02) plugs in below it.
function defaultLoadPage(url) {
  if (new URL(url).protocol !== 'file:') return null;
  return fs.readFileSync(fileURLToPath(url), 'utf8');
}

// The image-source boundary (G17.03): file:// fixtures only, every other
// scheme answers null (the image step turns that into a failed-step
// diagnostic). Returns bytes, not text. Network image transport stays out of
// G17.02's scope — live crawls mark image steps failed with this diagnostic.
function defaultLoadImage(url) {
  if (new URL(url).protocol !== 'file:') return null;
  return fs.readFileSync(fileURLToPath(url));
}

export function defaultHandlers({ loadPage = defaultLoadPage, loadImage = defaultLoadImage, fetchPage = null } = {}) {
  // One crawler per handlers instance — one campaign per runCampaign call, so
  // the politeness gate and the error-series counter span exactly one run. The
  // audit log lives in the campaign's run dir next to its snapshots.
  let crawler = null;
  let browser = null;
  function crawlerFor(ctx) {
    if (crawler) return crawler;
    crawler = createCrawler({
      auditPath: path.join(ctx.snapshotsRoot, ctx.campaignId.slice(0, 12), 'fence-audit.jsonl'),
      delayRange: ctx.campaign.fence.delay_s,
      fetchPage:
        fetchPage ??
        ((url) => {
          // The production fetcher is created on the first network URL and
          // closed when the run ends; file://-only runs never create it.
          if (!browser) {
            browser = createBrowserFetchPage({ userDataDir: ctx.campaign.browser_user_data_dir ?? null });
          }
          return browser.then((fetcher) => fetcher.fetchPage(url));
        }),
    });
    return crawler;
  }
  const handlers = {
    loadImage,
    seed(ctx, step) {
      const protocol = new URL(step.ref).protocol;
      if (protocol === 'http:' || protocol === 'https:') {
        return crawlerFor(ctx).crawl(ctx, step.ref, 0);
      }
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
    crawl(ctx, step) {
      const { depth } = parseCrawlDetail(step);
      return crawlerFor(ctx).crawl(ctx, step.ref, depth);
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
    async close() {
      if (!browser) return;
      // A failed launch already reported its diagnostic on the step that
      // triggered it; close() only reaps a fetcher that actually started.
      const fetcher = await Promise.resolve(browser).catch(() => null);
      await fetcher?.close();
    },
  };
  return handlers;
}

export async function runCampaign(
  db,
  campaign,
  { sourcePath, contentHash, handlers = defaultHandlers(), snapshotsRoot = defaultSnapshotsRoot() } = {}
) {
  const { campaignId } = ensureCampaign(db, { campaign, sourcePath, contentHash });
  const now = new Date().toISOString();
  for (const ref of campaign.youtube) enqueueStep(db, campaignId, 'youtube', ref, now);
  for (const url of campaign.seeds) enqueueStep(db, campaignId, 'seed', url, now);

  const counts = { campaignId, done: 0, failed: 0, stopped: null };
  const ctx = { db, campaign, campaignId, now, snapshotsRoot, loadImage: handlers.loadImage };
  // The loop drains: a seed or crawl handler enqueues its image and crawl
  // steps mid-run, so the claimable list is re-read until nothing is left —
  // one invocation finishes the whole campaign. Every processed step ends
  // 'done' or 'failed', so the drain terminates — unless a CrawlStopError
  // stops the run on purpose, leaving the unclaimed steps queued for resume.
  outer: for (;;) {
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
        // A step may answer an outcome note (the image step's skip message, a
        // crawl skip). It is appended to the work-order detail, never replaces
        // it — the detail is what a resumed process re-reads.
        const note = await handler(ctx, step);
        completeStep(
          db,
          step.id,
          now,
          typeof note === 'string' && note !== '' ? (step.detail ? `${step.detail} | ${note}` : note) : null
        );
        counts.done += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failStep(db, step.id, message, now);
        counts.failed += 1;
        if (error instanceof CrawlStopError) {
          counts.stopped = message;
          break outer;
        }
      }
    }
  }
  await handlers.close?.();
  return counts;
}

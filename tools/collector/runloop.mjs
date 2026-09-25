// Run loop (G17.01.a): register the campaign, enqueue its work items, execute
// claimable steps, record progress in run_log. Idempotent by construction —
// enqueuing and record registration use ON CONFLICT DO NOTHING, and steps
// already 'done' are never re-executed. A row left 'running' by an interrupted
// process is claimed again by the next run: resume, not restart.
//
// v0 fetches nothing for seeds (network crawling is G17.02). The default seed
// handler processes only pages a loader hands it: by default file:// seeds are
// read from disk — the local fixture boundary for the snapshot pipeline
// (G17.01.b) — and every other scheme answers null, so the seed stays
// progress-only, exactly as in G17.01.a. The default youtube handler registers
// the record shell so the library row exists before G17.05 fills it; rights
// per docs/24_web_collection.md — YouTube transcripts are research_only.
//
// Wiki steps (G17.04) fetch for real: the loadApi boundary performs the
// https call to the campaign's MediaWiki api.php endpoint — live runs are
// manual, tests inject recorded fixtures and never touch the network. The
// loop awaits handlers, so the run loop is async.
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
import {
  WIKI_RIGHTS,
  parseArticleResponse,
  parseCategoryMembersResponse,
  parseRequestUrl,
  categoryMembersRequestUrl,
  topicMatches,
  wikiArticleUrl,
  wikiAttribution,
  wikiDocument,
} from './wiki.mjs';

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

// The wiki API transport boundary (G17.04): the default loader performs the
// real http(s) fetch against the campaign's MediaWiki endpoint. Any other
// scheme answers null — the step handler turns that into a failed-step
// diagnostic naming the URL. Tests override this boundary; no test touches
// the network.
async function defaultLoadApi(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

export function defaultHandlers({ loadPage = defaultLoadPage, loadImage = defaultLoadImage, loadApi = defaultLoadApi } = {}) {
  return {
    loadImage,
    loadApi,
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
    // Wiki article step: the work order (detail JSON) carries the api
    // endpoint; the ref is the requested title. A response the transport or
    // parser cannot serve fails this one step with a diagnostic naming the
    // title and reason (missing title, bad JSON) — the run continues.
    async 'wiki-article'(ctx, step) {
      let order;
      try {
        order = JSON.parse(step.detail ?? '{}');
      } catch {
        throw new Error(`wiki-article '${step.ref}': unreadable work order`);
      }
      if (!order.api) throw new Error(`wiki-article '${step.ref}': work order without api`);
      const requestUrl = parseRequestUrl(order.api, step.ref);
      let payload;
      try {
        payload = await ctx.loadApi(requestUrl);
      } catch (error) {
        throw new Error(`wiki-article '${step.ref}': ${requestUrl}: ${error.message}`);
      }
      if (payload === null) {
        throw new Error(`wiki-article '${step.ref}': no transport for ${requestUrl} (http/https only)`);
      }
      const article = parseArticleResponse(payload, step.ref);
      // Photos are out of scope for G17.04: the HTML is snapshotted as-is, no
      // image steps are enqueued, media/ stays the empty G17.01.b folder.
      processFetchedPage(ctx.db, ctx.campaign, ctx.campaignId, {
        url: wikiArticleUrl(order.api, article.title),
        html: wikiDocument(article),
        now: ctx.now,
        snapshotsRoot: ctx.snapshotsRoot,
        sourceType: 'wiki',
        rights: WIKI_RIGHTS,
        attribution: wikiAttribution(order.api, article),
        metadataOverrides: { published_at: article.revisionTimestamp, author: article.revisionUser },
        enqueueImages: false,
      });
    },
    // Wiki category step: lists the category's articles and subcategories and
    // enqueues one step per member. The expansion limits come from the
    // campaign config: subcategories expand only within the depth budget and
    // only when the campaign's topic filter matches; a subcategory outside
    // either is not expanded and the reason lands in this step's detail.
    // Listed (root) categories bypass the topic filter — explicit opt-in.
    async 'wiki-category'(ctx, step) {
      const wiki = ctx.campaign.wiki;
      if (!wiki) throw new Error(`wiki-category '${step.ref}': campaign has no wiki block`);
      let order;
      try {
        order = JSON.parse(step.detail ?? '{}');
      } catch {
        throw new Error(`wiki-category '${step.ref}': unreadable work order`);
      }
      if (!order.api || !Number.isInteger(order.depth)) {
        throw new Error(`wiki-category '${step.ref}': work order without api/depth`);
      }
      const requestUrl = categoryMembersRequestUrl(order.api, step.ref);
      let payload;
      try {
        payload = await ctx.loadApi(requestUrl);
      } catch (error) {
        throw new Error(`wiki-category '${step.ref}': ${requestUrl}: ${error.message}`);
      }
      if (payload === null) {
        throw new Error(`wiki-category '${step.ref}': no transport for ${requestUrl} (http/https only)`);
      }
      const { articles, subcategories, hasMore } = parseCategoryMembersResponse(payload, step.ref);
      const notes = [];
      for (const title of articles) {
        enqueueStep(ctx.db, ctx.campaignId, 'wiki-article', title, ctx.now, JSON.stringify({ api: order.api }));
      }
      for (const title of subcategories) {
        // depth counts expansion levels: 1 — listed categories only, 2 —
        // plus their in-topic subcategories. A child whose depth reaches the
        // budget is not enqueued; the reason lands in this step's detail.
        const childDepth = order.depth + 1;
        if (childDepth >= wiki.depth) {
          notes.push(`'${title}' not expanded: depth limit ${wiki.depth} reached`);
          continue;
        }
        if (!topicMatches(ctx.campaign.topics, title)) {
          const topics = ctx.campaign.topics.length > 0 ? ctx.campaign.topics.join(', ') : 'none';
          notes.push(`'${title}' not expanded: no campaign topic matches (topics: ${topics})`);
          continue;
        }
        enqueueStep(ctx.db, ctx.campaignId, 'wiki-category', title, ctx.now, JSON.stringify({ api: order.api, depth: childDepth }));
      }
      if (hasMore) notes.push('category has more members (continue) — one batch per step in G17.04');
      if (notes.length === 0) return;
      return notes.join('; ');
    },
  };
}

export async function runCampaign(
  db,
  campaign,
  { sourcePath, contentHash, handlers = defaultHandlers(), snapshotsRoot = defaultSnapshotsRoot() } = {}
) {
  const { campaignId } = ensureCampaign(db, { campaign, sourcePath, contentHash });
  const now = new Date().toISOString();
  if (campaign.wiki) {
    for (const title of campaign.wiki.articles) {
      enqueueStep(db, campaignId, 'wiki-article', title, now, JSON.stringify({ api: campaign.wiki.api }));
    }
    for (const title of campaign.wiki.categories) {
      enqueueStep(db, campaignId, 'wiki-category', title, now, JSON.stringify({ api: campaign.wiki.api, depth: 0 }));
    }
  }
  for (const ref of campaign.youtube) enqueueStep(db, campaignId, 'youtube', ref, now);
  for (const url of campaign.seeds) enqueueStep(db, campaignId, 'seed', url, now);

  const counts = { campaignId, done: 0, failed: 0 };
  const ctx = { db, campaign, campaignId, now, snapshotsRoot, loadImage: handlers.loadImage, loadApi: handlers.loadApi };
  // The loop drains: a handler enqueues new steps mid-run (a category lists
  // its articles), so the claimable list is re-read until nothing is left —
  // one invocation finishes the whole campaign. Every processed step ends
  // 'done' or 'failed', so the drain terminates.
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
        // A step may answer an outcome note (the image step's skip message,
        // the category step's expansion notes). It is appended to the
        // work-order detail, never replaces it — the detail is what a
        // resumed process re-reads.
        const note = await handler(ctx, step);
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

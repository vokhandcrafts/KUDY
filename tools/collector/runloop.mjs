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
// scheme stays progress-only, exactly as in G17.01.a.
//
// G17.15 puts the robots.txt gate inside that crawler: every http(s) seed and
// crawl step is robots-checked before its fetch (refusals are audited with a
// reason). A run whose every http(s) seed is refused ends with the
// all-seeds-blocked stop diagnostic below — never as an empty success.
//
// A CrawlStopError (error series, crawler.mjs) stops the whole run: the step
// is marked failed with the diagnostic, the remaining queue stays untouched,
// and runCampaign reports `stopped` so the CLI can surface it.
//
// Wiki steps (G17.04) fetch for real: the loadApi boundary performs the
// http(s) call to the campaign's MediaWiki api.php endpoint — live runs are
// manual, tests inject recorded fixtures and never touch the network. The
// loop awaits handlers, so the run loop is async.
//
// The collection transport (G17.19, transport.mjs): the campaign's transport
// field routes every network channel — the browser fetcher, the robots.txt
// gate, the wiki api calls and the yt-dlp/cover pipeline — through the user's
// tor daemon (SOCKS5 127.0.0.1:9050) when it is 'tor', and leaves today's
// direct behavior untouched otherwise. All the transports are lazy: a
// file://-only campaign never creates a browser, a dispatcher or a proxy.
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
} from './store.mjs';
import { processImageStep } from './media.mjs';
import { defaultSnapshotsRoot, processFetchedPage } from './snapshot.mjs';
import { CrawlStopError, createCrawler, createPoliteness, parseCrawlDetail } from './crawler.mjs';
import { RobotsBlockedError, defaultFetchRobots } from './robots.mjs';
import { createBrowserFetchPage } from './netfetch.mjs';
import { createNetGuard } from './netguard.mjs';
import { createBacklogWriter, createYoutubeFetch, processYoutubeStep } from './youtube.mjs';
import { TOR_SOCKS5H_PROXY, createTorDispatcher, torDownDiagnostic, transportProxy } from './transport.mjs';
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
// from local fixtures; the network crawl (G17.02) plugs in below it.
function defaultLoadPage(url) {
  if (new URL(url).protocol !== 'file:') return null;
  return fs.readFileSync(fileURLToPath(url), 'utf8');
}

// The image-source boundary (G17.03): file:// fixtures only, every other
// scheme answers null (the image step turns that into a failed-step
// diagnostic). Returns bytes, not text. Network image transport stays out of
// G17.02's scope — live crawls mark image steps failed with this diagnostic.
// When that transport lands, it must call the net guard (netguard.mjs) before
// fetching, like every other collector network path.
function defaultLoadImage(url) {
  if (new URL(url).protocol !== 'file:') return null;
  return fs.readFileSync(fileURLToPath(url));
}

// The wiki API transport boundary (G17.04): the default loader performs the
// real http(s) fetch against the campaign's MediaWiki endpoint. Any other
// scheme answers null — the step handler turns that into a failed-step
// diagnostic naming the URL. Tests override this boundary; no test touches
// the network. Under the Tor transport (G17.19) the dispatcher rides along:
// connection-level failures carry the tor-down hint, site-level ones (HTTP
// ≥ 400) mean the proxy worked and keep their plain message.
async function defaultLoadApi(url, { dispatcher = null } = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  let response;
  try {
    response = await fetch(url, dispatcher ? { dispatcher } : undefined);
  } catch (error) {
    throw dispatcher ? torDownDiagnostic(error) : error;
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

export function defaultHandlers({
  loadPage = defaultLoadPage,
  loadImage = defaultLoadImage,
  fetchPage = null,
  // No default here: undefined falls through to createRobotsGate's own
  // production transport (robots.mjs defaultFetchRobots); tests inject one.
  // Under the Tor transport the runloop wraps that production transport with
  // the SOCKS5 dispatcher (fetchRobotsFor) — the robots.txt request is part
  // of the crawl channel.
  fetchRobots,
  // No defaults here either: youtubeFetch and loadApi are created lazily per
  // run (youtubeFor / loadApiFor) because the production transports depend on
  // the campaign's chosen collection transport; tests inject one.
  youtubeFetch = null,
  loadApi = null,
  netGuard = createNetGuard(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  // One crawler per handlers instance — one campaign per runCampaign call, so
  // the politeness gate, the robots.txt cache and the error-series counter
  // span exactly one run. The audit log lives in the campaign's run dir next
  // to its snapshots.
  let crawler = null;
  let browser = null;
  let backlog = null;
  let politeness = null;
  let youtube = null;
  let apiTransport = null;
  let dispatcherPromise = null;
  // One per-host politeness clock for the whole run (spec: «затрымка 2–5 с
  // паміж запытамі да аднаго хоста»), shared by the crawl and the wiki api
  // calls — the G17.08 pilot saw live HTTP 429s while two independent gates
  // let the crawl and the api fire at the same host concurrently.
  function politenessFor(ctx) {
    if (politeness) return politeness;
    politeness = createPoliteness(ctx.campaign.fence.delay_s, { sleep });
    return politeness;
  }
  // The Tor transport's shared dispatcher (G17.19): created on the first
  // channel use, so direct and file:// campaigns never create a proxy — the
  // same lazy contract the browser has. One promise per run; a failed
  // creation is not memoized — the next channel use retries, matching
  // youtube.mjs's dispatcherFor.
  function dispatcherFor(ctx) {
    if (transportProxy(ctx.campaign) === null) return null;
    if (dispatcherPromise === null) {
      dispatcherPromise = createTorDispatcher().catch((error) => {
        dispatcherPromise = null;
        throw error;
      });
    }
    return dispatcherPromise;
  }
  function fetchRobotsFor(ctx) {
    if (fetchRobots) return fetchRobots;
    const dispatcher = dispatcherFor(ctx);
    if (dispatcher === null) return undefined; // robots.mjs default, direct
    return async (url) => defaultFetchRobots(url, { dispatcher: await dispatcher });
  }
  function crawlerFor(ctx) {
    if (crawler) return crawler;
    crawler = createCrawler({
      auditPath: path.join(ctx.snapshotsRoot, ctx.campaignId.slice(0, 12), 'fence-audit.jsonl'),
      delayRange: ctx.campaign.fence.delay_s,
      netGuard,
      fetchRobots: fetchRobotsFor(ctx),
      gate: politenessFor(ctx),
      fetchPage:
        fetchPage ??
        ((url) => {
          // The production fetcher is created on the first network URL and
          // closed when the run ends; file://-only runs never create it.
          if (!browser) {
            browser = createBrowserFetchPage({
              userDataDir: ctx.campaign.browser_user_data_dir ?? null,
              proxyUrl: transportProxy(ctx.campaign),
            });
          }
          return browser.then((fetcher) => fetcher.fetchPage(url));
        }),
    });
    return crawler;
  }
  function youtubeFor(ctx) {
    if (youtube) return youtube;
    youtube =
      youtubeFetch ??
      createYoutubeFetch({
        proxy: ctx.campaign.transport === 'tor' ? TOR_SOCKS5H_PROXY : null,
      });
    return youtube;
  }
  function loadApiFor(ctx) {
    if (loadApi) return loadApi;
    if (apiTransport === null) {
      apiTransport = async (url) => defaultLoadApi(url, { dispatcher: await dispatcherFor(ctx) });
    }
    return apiTransport;
  }
  const handlers = {
    loadImage,
    // The wiki transport boundary in its direct form — the module seam the
    // suites call directly. The wiki steps themselves go through loadApiFor:
    // under the tor transport it wraps this boundary with the SOCKS5
    // dispatcher (an injected loadApi is returned as-is there).
    loadApi: loadApi ?? defaultLoadApi,
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
    youtube(ctx, step) {
      // G17.05: the shell row exists first (G17.01.a contract), then the
      // yt-dlp pipeline fills it — transcript, metadata, cover — or defers
      // the video to asr-backlog. The binary lives behind youtubeFetch;
      // live runs are manual, tests spawn a stub command. The production
      // fetch (youtubeFor) is created on the first youtube step so the
      // transport comes from the campaign (G17.19).
      if (!backlog) {
        backlog = createBacklogWriter(path.join(ctx.snapshotsRoot, ctx.campaignId.slice(0, 12), 'asr-backlog.jsonl'));
      }
      return processYoutubeStep({ ...ctx, youtubeFetch: youtubeFor(ctx), backlog }, step);
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
      await politenessFor(ctx)(new URL(requestUrl).hostname);
      let payload;
      try {
        // The api endpoint is a campaign-configured address — guarded like a
        // seed before the transport touches it.
        await netGuard(requestUrl);
        payload = await loadApiFor(ctx)(requestUrl);
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
      await politenessFor(ctx)(new URL(requestUrl).hostname);
      let payload;
      try {
        await netGuard(requestUrl);
        payload = await loadApiFor(ctx)(requestUrl);
      } catch (error) {
        throw new Error(`wiki-category '${step.ref}': ${requestUrl}: ${error.message}`);
      }
      if (payload === null) {
        throw new Error(`wiki-category '${step.ref}': no transport for ${requestUrl} (http/https only)`);
      }
      const { articles, subcategories, skipped, hasMore } = parseCategoryMembersResponse(payload, step.ref);
      const notes = [];
      for (const { title, ns } of skipped) {
        notes.push(`'${title}' skipped: namespace ${ns} is not article content`);
      }
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

  const counts = { campaignId, done: 0, failed: 0, stopped: null, robotsBlockedSeeds: 0 };
  const ctx = { db, campaign, campaignId, now, snapshotsRoot, loadImage: handlers.loadImage };
  // The loop drains: a seed, crawl or wiki-category handler enqueues new steps
  // mid-run, so the claimable list is re-read until nothing is left — one
  // invocation finishes the whole campaign. Every processed step ends 'done'
  // or 'failed', so the drain terminates — unless a CrawlStopError stops the
  // run on purpose, leaving the unclaimed steps queued for resume.
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
        // crawl skip, the category step's expansion notes). It is appended to
        // the work-order detail, never replaces it — the detail is what a
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
        const message = error instanceof Error ? error.message : String(error);
        failStep(db, step.id, message, now);
        counts.failed += 1;
        if (error instanceof RobotsBlockedError) counts.robotsBlockedSeeds += 1;
        if (error instanceof CrawlStopError) {
          counts.stopped = message;
          break outer;
        }
      }
    }
  }
  // G17.15: every http(s) seed refused by robots.txt and nothing collected —
  // the run ends with a readable stop diagnostic, not an empty «successful»
  // run. Mixed campaigns (file:// seeds, youtube or wiki work done) ran real
  // work, so only the fully-refused case reports the stop.
  const httpSeedCount = new Set(
    campaign.seeds.filter((url) => /^https?:$/.test(new URL(url).protocol))
  ).size;
  if (httpSeedCount > 0 && counts.robotsBlockedSeeds === httpSeedCount && counts.done === 0) {
    counts.stopped = `all ${httpSeedCount} http(s) seed(s) refused by robots.txt — run stopped, nothing collected`;
  }
  await handlers.close?.();
  return counts;
}

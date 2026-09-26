// The crawl pipeline (G17.02): one URL per step, walked inside the fence.
// Discovered links are audited and enqueued (kind 'crawl', hop depth in the
// step detail); every executed step is fence-checked again, politeness-delayed
// per host, fetched through the injected fetchPage boundary, classified by the
// article heuristic and handed to the G17.01.b snapshot writer — the same
// processFetchedPage path the file:// seed handler uses (no test shortcut).
//
// The fence audit log gets one line per event: a DENIED line when discovery
// meets an outside host (the URL is never enqueued), an ALLOWED line when a
// URL's fetch is decided (fetched true — bytes downloaded; false — the URL was
// already registered or the attempt failed). The pilot criterion «0 pages
// outside allowed hosts» is a grep for denied lines with fetched:true — there
// are none unless the fence itself is broken.
import { extractPage } from './extract.mjs';
import { createAuditWriter, fenceHosts, hostnameOf, hostAllowed } from './fence.mjs';
import { enqueueStep } from './store.mjs';
import { processFetchedPage } from './snapshot.mjs';

// «Ветлівасць: спыненне па серыі памылак» — N consecutive failed crawl steps
// stop the run with a diagnostic: fetch failures count, and so does every
// non-fetch step failure (unidentifiable page, redirect outside the fence,
// snapshot error). A completed step — snapshot or skip — resets the series;
// unclaimed steps stay queued for the next run.
export const ERROR_SERIES_LIMIT = 3;

// «Бяром старонкі, якія выглядаюць як артыкул: загаловак + дастаткова абзацаў
// тэксту» — a page with fewer text paragraphs than this is a menu, catalog or
// service page and is skipped, not snapshotted.
export const MIN_ARTICLE_PARAGRAPHS = 3;

export class CrawlStopError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CrawlStopError';
  }
}

// Per-host politeness (docs/24_web_collection.md: «затрымка 2–5 с паміж
// запытамі да аднаго хоста»): each gate call waits until the previous request
// to the same hostname is at least delayRange-min old. The wait is drawn from
// [min, max] per request; the recorded moment is the request start, so two
// consecutive starts are never closer than the configured minimum.
export function createPoliteness(
  delayRange,
  { sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now } = {}
) {
  const lastStart = new Map();
  return async function gate(hostname) {
    const [minS, maxS] = delayRange;
    const delayMs = (minS + Math.random() * (maxS - minS)) * 1000;
    const last = lastStart.get(hostname);
    if (last !== undefined) {
      const remaining = last + delayMs - now();
      if (remaining > 0) await sleep(remaining);
    }
    lastStart.set(hostname, now());
  };
}

// The step's work order: JSON detail carrying the hop depth. Corrupt detail is
// a named diagnostic, not a crash (implementation-rules 14).
export function parseCrawlDetail(step) {
  let detail;
  try {
    detail = JSON.parse(step.detail);
  } catch (error) {
    throw new Error(`crawl step ${step.ref}: corrupt detail — ${error.message}`);
  }
  if (detail === null || typeof detail !== 'object' || !Number.isInteger(detail.depth) || detail.depth < 0) {
    throw new Error(`crawl step ${step.ref}: corrupt detail — expected {"depth": <integer ≥ 0>}`);
  }
  return detail;
}

export function createCrawler({ fetchPage, auditPath, delayRange }) {
  const audit = createAuditWriter(auditPath);
  const gate = createPoliteness(delayRange);
  let consecutiveErrors = 0;

  // Discovery: a link met on a fetched article. Outside hosts are audited
  // DENIED and never enqueued; inside hosts are audited ALLOWED and queued
  // while the hop depth stays within fence.depth.
  function consider(ctx, url, depth) {
    const allowed = fenceHosts(ctx.campaign);
    if (!hostAllowed(url, allowed)) {
      audit({ url, decision: 'denied', fetched: false });
      return;
    }
    audit({ url, decision: 'allowed', fetched: false });
    if (depth > ctx.campaign.fence.depth) return;
    enqueueStep(ctx.db, ctx.campaignId, 'crawl', url, ctx.now, JSON.stringify({ depth }));
  }

  // The series counter wraps the whole step, not only the fetch (issue #261):
  // docs/24 stops a run on «спыненне па серыі памылак», so any failing crawl
  // step counts and a completed step — snapshot or skip — resets the series.
  // crawlStep throws the bare reason; the single `crawl <url>: ` prefix lands
  // here, keeping single-failure diagnostics byte-identical with the
  // fetch-only counter they replace.
  async function crawl(ctx, url, depth) {
    try {
      const outcome = await crawlStep(ctx, url, depth);
      consecutiveErrors = 0;
      return outcome;
    } catch (error) {
      if (error instanceof CrawlStopError) throw error;
      consecutiveErrors += 1;
      if (consecutiveErrors >= ERROR_SERIES_LIMIT) {
        throw new CrawlStopError(
          `error series: ${ERROR_SERIES_LIMIT} consecutive crawl failures, last at ${url} (${error.message}) — ` +
            'run stopped, queued steps resume on the next run'
        );
      }
      throw new Error(`crawl ${url}: ${error.message}`);
    }
  }

  async function crawlStep(ctx, url, depth) {
    const { db, campaign, campaignId, now, snapshotsRoot } = ctx;
    const allowed = fenceHosts(campaign);

    // Execution-time re-check: steps reach the queue only through consider's
    // fence, so a violation here means a corrupt or tampered step — refuse
    // with a diagnostic, never fetch.
    if (!hostAllowed(url, allowed)) {
      audit({ url, decision: 'denied', fetched: false });
      throw new Error('host is outside the campaign fence — refusing to fetch');
    }
    if (depth > campaign.fence.depth) {
      throw new Error(`depth ${depth} exceeds the fence depth ${campaign.fence.depth}`);
    }

    // A URL already in the library (the seed page linked back from an article)
    // is skipped without refetching — the snapshot writer's UNIQUE(campaign_id,
    // url) would turn the fetch into 'duplicate-url' file work anyway.
    const registered = db
      .prepare('SELECT id FROM raw_records WHERE campaign_id = ? AND url = ?')
      .get(campaignId, url);
    if (registered) {
      audit({ url, decision: 'allowed', fetched: false });
      return `skipped: URL already registered as ${registered.id.slice(0, 8)}`;
    }

    await gate(hostnameOf(url));
    let html;
    let finalUrl;
    try {
      ({ html, finalUrl = url } = await fetchPage(url));
    } catch (error) {
      audit({ url, decision: 'allowed', fetched: false });
      throw error;
    }
    audit({ url, decision: 'allowed', fetched: true });

    // A redirect can leave the fence without discovery seeing it: the browser
    // already downloaded the bytes, so the audit says so (denied + fetched)
    // and the content is discarded — the pilot criterion must see the breach.
    if (!hostAllowed(finalUrl, allowed)) {
      audit({ url: finalUrl, decision: 'denied', fetched: true });
      throw new Error(`redirected outside the fence to ${finalUrl} — content discarded`);
    }

    // The heuristic classifies before the snapshot writer runs: a page that
    // carries no article text (menu, catalog, service page) is skipped; only
    // an unidentifiable document (empty, no title) fails the step.
    let page;
    try {
      page = extractPage(html, url);
    } catch (error) {
      if (error.code === 'no-article-text') return 'skipped: nav-only page — no paragraph text';
      throw error;
    }
    if (page.paragraphCount < MIN_ARTICLE_PARAGRAPHS) {
      return `skipped: ${page.paragraphCount} paragraph(s) < ${MIN_ARTICLE_PARAGRAPHS} — not an article page`;
    }

    const result = processFetchedPage(db, campaign, campaignId, { url, html, now, snapshotsRoot });
    // Links are discovered from the store, not re-extracted: the snapshot
    // writer persisted every link of the article (processFetchedPage → links).
    for (const link of db.prepare('SELECT url FROM links WHERE raw_record_id = ?').all(result.recordId)) {
      consider(ctx, link.url, depth + 1);
    }
    return null;
  }

  return { audit, consider, crawl };
}

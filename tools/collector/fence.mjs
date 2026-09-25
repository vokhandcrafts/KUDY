// The fence (G17.02) — the safety contract of the crawler, docs/24_web_collection.md
// «Калектары → Паўзук па сайтах»: «толькі свой домен, плюс яўна дазволеныя
// дадатковыя». Without it the crawler "reads the whole internet"; the fence
// audit log is the evidence that it held.
//
// Hostname comparison is exact and fail-closed: a subdomain of an allowed
// host is a different host, an unparseable URL is never allowed. The campaign
// seeds define the base set; `fence.extra_domains` widens it with explicit
// hostnames.

import fs from 'node:fs';
import path from 'node:path';

// The campaign's allowed hostnames: every seed's host plus fence.extra_domains
// (exact hostnames, lowercased). Seeds themselves are the author's explicit
// choice, so they are inside the fence by construction.
export function fenceHosts(campaign) {
  const hosts = new Set();
  for (const url of campaign.seeds) {
    const hostname = hostnameOf(url);
    if (hostname !== null) hosts.add(hostname);
  }
  for (const domain of campaign.fence.extra_domains) hosts.add(domain.trim().toLowerCase());
  return hosts;
}

export function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// One fence verdict. `false` on an unparseable URL — a URL the fence cannot
// read is a URL it must not fetch.
export function hostAllowed(url, allowedHosts) {
  const hostname = hostnameOf(url);
  if (hostname === null) return false;
  return allowedHosts.has(hostname);
}

// The audit log line format is pinned for the pilot's literal grep
// («Пілот» criterion 1 — 0 pages outside allowed hosts): fixed field order
// (url, decision, fetched), one space after each colon, JSON-string-escaped
// url — so `grep '"decision": "denied", "fetched": true'` over the file stays
// meaningful forever. decision is 'allowed' | 'denied' (the host fence);
// fetched says whether this run downloaded bytes for the URL.
export function serializeAuditLine({ url, decision, fetched }) {
  return `{"url": ${JSON.stringify(url)}, "decision": ${JSON.stringify(decision)}, "fetched": ${fetched}}`;
}

// Append-only JSONL writer: one line per fence event, flushed synchronously so
// an interrupted run leaves no half-written verdicts behind.
export function createAuditWriter(auditPath) {
  const dir = path.dirname(auditPath);
  let madeDir = false;
  return function audit({ url, decision, fetched }) {
    if (!madeDir) {
      fs.mkdirSync(dir, { recursive: true });
      madeDir = true;
    }
    fs.appendFileSync(auditPath, `${serializeAuditLine({ url, decision, fetched })}\n`);
  };
}

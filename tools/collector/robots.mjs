// The robots.txt gate (G17.15, docs/24_web_collection.md «Калектары → Паўзук
// па сайтах»): before the crawl fetches a URL, the campaign reads each allowed
// domain's robots.txt and never requests paths disallowed for crawlers. The
// refusal is audited with a readable reason (crawler.mjs), not silently
// ignored. Per run, per host: the robots.txt document is fetched once and
// cached (createRobotsGate lives inside createCrawler — one instance per run).
//
// Parsing subset (RFC 9309): User-agent groups with Allow/Disallow rules,
// '*' wildcard and '$' anchor in patterns, prefix matching. The gate evaluates
// only the group of the collector's own product token (ROBOTS_AGENT) or '*';
// rules of other agents are not ours (the task's out-of-scope list). Missing
// robots.txt (404/410) is the standard «everything allowed»; a server error is
// read conservatively — the host is not visited for the rest of this run.
// Wiki and YouTube never reach this gate: they go through official APIs, not
// the crawl path (out of scope per the issue).
import { torDownDiagnostic } from './transport.mjs';

// The product token the gate matches robots.txt groups against. The collector
// has no configured user-agent string anywhere else (grep-checked 2026-09-29);
// this constant is the single definition of its crawl identity.
export const ROBOTS_AGENT = 'KUDY-collector';

// A robots refusal is not a crawl failure: it must not feed the crawler's
// error series and must never stop the run. runCampaign counts the seed-step
// refusals for the all-seeds-blocked epilogue.
export class RobotsBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RobotsBlockedError';
  }
}

function escapeLiteral(segment) {
  return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// RFC 9309 pattern: literal text with '*' (any run of characters) and a
// trailing '$' (end of path). Everything else matches literally — including
// '?' of query strings.
function compilePattern(pattern) {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = new RegExp(`^${body.split('*').map(escapeLiteral).join('.*')}${anchored ? '$' : ''}`);
  return (path) => regex.test(path);
}

// robots.txt text → { allowed(path) } for the agent's winning group, where
// path is pathname + query. Longest matching pattern wins; a tie is resolved
// permissively (Allow). No matching group, a group without rules or an empty
// Disallow value all mean «everything allowed». Unparseable lines are ignored,
// never thrown on — robots.txt is foreign text, not a contract (rule 14).
export function parseRobotsTxt(text, agent = ROBOTS_AGENT) {
  const groups = [];
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const hash = rawLine.indexOf('#');
    const line = (hash === -1 ? rawLine : rawLine.slice(0, hash)).trim();
    if (line === '') continue;
    const match = /^([a-zA-Z-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === 'user-agent') {
      // Consecutive user-agent lines share one group; a new agent after rules
      // starts the next group.
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (field === 'allow' || field === 'disallow') {
      if (!current) continue; // a rule before any user-agent line has no owner
      if (value === '') continue; // empty Disallow = no restriction; empty Allow is a no-op
      current.rules.push({ allow: field === 'allow', pattern: value });
    }
    // crawl-delay, sitemap and unknown fields are not the crawl gate's concern.
  }
  const token = agent.toLowerCase();
  const group =
    groups.find((candidate) => candidate.agents.includes(token)) ??
    groups.find((candidate) => candidate.agents.includes('*'));
  if (!group) return { allowed: () => true };
  const rules = group.rules.map((rule) => ({ ...rule, match: compilePattern(rule.pattern) }));
  return {
    allowed(path) {
      let best = null;
      for (const rule of rules) {
        if (!rule.match(path)) continue;
        if (best === null || rule.pattern.length > best.pattern.length) best = rule;
        else if (rule.pattern.length === best.pattern.length && rule.allow && !best.allow) best = rule;
      }
      return best === null || best.allow;
    },
  };
}

// The production transport: a plain GET, no browser — robots.txt is static
// text. Returns the document text, or null when the file is missing (404/410:
// the standard «everything allowed»); any other HTTP error throws — the gate
// reads that as «unavailable» and skips the host for this run. Network errors
// (DNS, refused connection) throw the same way. Under the Tor transport
// (G17.19) the runloop passes the SOCKS5 dispatcher — the robots.txt request
// is part of the crawl channel and would expose the author's IP if it went
// direct while the pages went through Tor.
export async function defaultFetchRobots(url, { dispatcher = null } = {}) {
  let response;
  try {
    response = await fetch(url, dispatcher ? { dispatcher } : undefined);
  } catch (error) {
    // Connection-level failure: under the Tor transport the daemon is the
    // first suspect, and the robots gate is the first request of every host —
    // the gate's «unavailable» reason then carries the hint. Site-level
    // statuses below mean the proxy worked and stay plain.
    throw dispatcher ? torDownDiagnostic(error) : error;
  }
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

// The per-run gate. verdict(url) → { allowed: true } or { allowed: false,
// reason }. The robots.txt document is fetched once per host (cached for the
// whole run) and the request itself is politeness-gated like a page fetch —
// it is a request to the host, docs/24 «затрымка паміж запытамі да аднаго
// хоста». `gate` is the crawler's politeness gate; tests inject fetchRobots.
export function createRobotsGate({ fetchRobots = defaultFetchRobots, agent = ROBOTS_AGENT, gate = null } = {}) {
  const cache = new Map(); // hostname → { kind: 'open' | 'missing' | 'closed', matcher?, reason? }
  async function load(hostname, url) {
    try {
      const text = await fetchRobots(new URL(url).origin + '/robots.txt');
      return text === null ? { kind: 'missing' } : { kind: 'open', matcher: parseRobotsTxt(text, agent) };
    } catch (error) {
      return {
        kind: 'closed',
        reason: `robots.txt of ${hostname} unavailable (${error.message}) — host is not visited this run`,
      };
    }
  }
  return async function verdict(url) {
    const parsed = new URL(url);
    if (parsed.hostname === '') return { allowed: true }; // no host — no robots contract (file://)
    let state = cache.get(parsed.hostname);
    if (!state) {
      if (gate) await gate(parsed.hostname);
      state = await load(parsed.hostname, url);
      cache.set(parsed.hostname, state);
    }
    if (state.kind === 'missing') return { allowed: true };
    if (state.kind === 'closed') return { allowed: false, reason: state.reason };
    const path = parsed.pathname + parsed.search;
    if (state.matcher.allowed(path)) return { allowed: true };
    return { allowed: false, reason: `robots.txt of ${parsed.hostname} disallows ${path}` };
  };
}

// MediaWiki wiki collector (G17.04, docs/24_web_collection.md
// «Калектары → Энцыклапедыі і вікі»). Pure functions over the MediaWiki API
// contract: request URLs, response parsing, the campaign topic filter and the
// attribution record. The run loop (runloop.mjs) drives them through the
// loadApi transport boundary.
//
// Rights per the spec («Правы»): «Вікіпедыя і MediaWiki-сайты — licensed
// (CC BY-SA): цытата дазволена з атрыбуцыяй». The two constants below ARE
// that mapping; reverting either fails the rights/attribution tests.

export const WIKI_RIGHTS = 'licensed';
export const WIKI_LICENSE = 'CC BY-SA';

// The article's web address: api.php → /wiki/<Title> on the same origin. This
// is the RawRecord url («адкуль узята») and the base every relative wiki link
// resolves against, so two spellings of one title ('gdansk', 'Gdansk') dedup
// on the API's normalized title.
export function wikiArticleUrl(api, title) {
  return `${new URL(api).origin}/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`;
}

// Contributors page for the attribution record: MediaWiki keeps index.php in
// the same directory as api.php; the revision history is the contributors
// list.
export function wikiHistoryUrl(api, title) {
  const url = new URL(api);
  url.pathname = url.pathname.replace(/api\.php$/, 'index.php');
  url.search = '';
  url.searchParams.set('title', title.replaceAll(' ', '_'));
  url.searchParams.set('action', 'history');
  return url.href;
}

export function parseRequestUrl(api, title) {
  const url = new URL(api);
  url.search = '';
  url.searchParams.set('action', 'parse');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('prop', 'text|revisions');
  url.searchParams.set('page', title);
  return url.href;
}

export function categoryMembersRequestUrl(api, title) {
  const url = new URL(api);
  url.search = '';
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('list', 'categorymembers');
  url.searchParams.set('cmtitle', title);
  url.searchParams.set('cmtype', 'page|subcat');
  url.searchParams.set('cmlimit', 'max');
  return url.href;
}

// Corrupt or error payloads answer a thrown diagnostic naming the requested
// title and the reason; the run loop records it in run_log and moves on
// (implementation-rules 14: corrupt input → diagnostics, not crashes).
export function parseArticleResponse(payload, title) {
  let json;
  try {
    json = JSON.parse(payload);
  } catch (error) {
    throw new Error(`wiki api response for '${title}': not valid JSON — ${error.message}`);
  }
  if (json && typeof json === 'object' && json.error) {
    const code = json.error.code ?? 'unknown';
    const info = json.error.info ?? 'no info';
    throw new Error(`wiki api error for '${title}': ${code} — ${info}`);
  }
  const parse = json?.parse;
  if (!parse) throw new Error(`wiki api response for '${title}': missing 'parse' section`);
  if (typeof parse.title !== 'string' || parse.title === '') {
    throw new Error(`wiki api response for '${title}': missing normalized title (parse.title)`);
  }
  if (typeof parse.text !== 'string' || parse.text.trim() === '') {
    throw new Error(`wiki api response for '${parse.title}': missing article HTML (parse.text)`);
  }
  const revision = Array.isArray(parse.revisions) ? parse.revisions[0] : undefined;
  if (!revision || revision.revid === undefined) {
    throw new Error(`wiki api response for '${parse.title}': missing revision metadata (parse.revisions)`);
  }
  return {
    title: parse.title,
    html: parse.text,
    revisionId: revision.revid,
    revisionTimestamp: revision.timestamp ?? null,
    revisionUser: revision.user ?? null,
  };
}

export function parseCategoryMembersResponse(payload, title) {
  let json;
  try {
    json = JSON.parse(payload);
  } catch (error) {
    throw new Error(`wiki api response for category '${title}': not valid JSON — ${error.message}`);
  }
  if (json && typeof json === 'object' && json.error) {
    const code = json.error.code ?? 'unknown';
    const info = json.error.info ?? 'no info';
    throw new Error(`wiki api error for category '${title}': ${code} — ${info}`);
  }
  const members = json?.query?.categorymembers;
  if (!Array.isArray(members)) {
    throw new Error(`wiki api response for category '${title}': missing query.categorymembers`);
  }
  const articles = [];
  const subcategories = [];
  const skipped = [];
  for (const member of members) {
    if (!member || typeof member.title !== 'string' || typeof member.ns !== 'number') {
      throw new Error(`wiki api response for category '${title}': member without ns/title`);
    }
    if (member.ns === 0) articles.push(member.title);
    else if (member.ns === 14) subcategories.push(member.title);
    // cmtype=page|subcat still lists non-content pages (templates, stub
    // banners, …) as type "page" — a legitimate API answer the collector does
    // not consume: skipped with a note, never a failed category.
    else skipped.push({ title: member.title, ns: member.ns });
  }
  // A follow-up batch exists (json.continue): reported, not silently dropped —
  // G17.04 collects one batch per category step.
  return { articles, subcategories, skipped, hasMore: Boolean(json.continue) };
}

// «пераход па вікі-спасылках — у межах зададзеных тэм і глыбіні» — the
// campaign's topics are the filter. A subcategory is expanded only when one of
// the campaign topics appears in its title (case-insensitive substring, the
// 'Category:' namespace prefix ignored). A listed (root) category bypasses
// the filter — the operator chose it explicitly. An empty topics list matches
// nothing: no blind expansion.
export function topicMatches(topics, categoryTitle) {
  const bare = categoryTitle.replace(/^Category:/i, '').toLowerCase();
  return topics.some((topic) => bare.includes(topic.toLowerCase()));
}

export function wikiAttribution(api, article) {
  return {
    site: new URL(api).origin,
    revision_id: article.revisionId,
    contributors_url: wikiHistoryUrl(api, article.title),
    license: WIKI_LICENSE,
  };
}

// action=parse (prop=text) answers an article-body fragment, not a full
// document; extractPage needs a <title> to identify the page. The wrapper
// carries the API's normalized title. Content language is not part of the
// parse response, so metadata.language stays null (absent metadata is null —
// the G17.01.b convention).
export function wikiDocument(article) {
  return `<html><head><title>${article.title}</title></head><body>${article.html}</body></html>`;
}

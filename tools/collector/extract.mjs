// HTML extraction for the raw snapshot (G17.01.b). v0 parses with tolerant
// regexes — the real DOM parser arrives with the crawler (G17.02, Playwright).
// Everything here is deterministic: the same HTML must always produce the same
// text.md bytes, because content_hash dedup compares those bytes across pages
// (docs/24_web_collection.md «Пашпарт запісу (RawRecord)»: content_hash —
// дэдуплікацыя зместу).
//
// Corrupt input (empty document, missing <title>, no paragraph text) throws a
// named diagnostic; the run loop records it in run_log and moves on.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
}

function collapse(text) {
  return text.replace(/\s+/g, ' ').trim();
}

// Attribute order inside a tag varies, so name/property and content are matched
// separately against the whole tag string.
function metaContent(html, key) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = tag.match(/\b(?:name|property)\s*=\s*"([^"]*)"/i)?.[1];
    if (name && name.toLowerCase() === key.toLowerCase()) {
      const content = tag.match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1];
      if (content !== undefined) return decodeEntities(content);
    }
  }
  return null;
}

function declaredCanonical(html, baseUrl) {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/\brel\s*=\s*"canonical"/i.test(tag)) continue;
    const href = tag.match(/\bhref\s*=\s*"([^"]*)"/i)?.[1];
    if (href !== undefined) {
      try {
        return new URL(decodeEntities(href), baseUrl).href;
      } catch {
        return baseUrl; // an unresolvable canonical falls back to the page URL
      }
    }
  }
  return baseUrl;
}

export function extractPage(html, baseUrl) {
  if (typeof html !== 'string' || html.trim() === '') {
    throw new Error('empty document — nothing to extract');
  }
  const rawTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = rawTitle === undefined ? null : collapse(decodeEntities(rawTitle));
  if (!title) {
    throw new Error('missing <title> — the page cannot be identified');
  }

  const paragraphs = [];
  for (const raw of html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/gi) ?? []) {
    const inner = raw.slice(raw.indexOf('>') + 1, raw.lastIndexOf('<'));
    const links = [];
    const text = collapse(
      decodeEntities(
        inner
          .replace(/<a\b[^>]*\bhref\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (match, href, anchorHtml) => {
            const label = collapse(decodeEntities(anchorHtml.replace(/<[^>]+>/g, '')));
            if (label === '') return '';
            try {
              const resolved = new URL(decodeEntities(href), baseUrl).href;
              links.push({ anchor: label, url: resolved });
              return `[${label}](${resolved})`;
            } catch {
              return label; // an unresolvable href keeps its text, loses the link
            }
          })
          .replace(/<br\s*\/?>/gi, ' ')
          .replace(/<[^>]+>/g, '')
      )
    );
    if (text !== '') {
      for (const link of links) link.context = text;
      paragraphs.push({ text, links });
    }
  }
  if (paragraphs.length === 0) {
    throw new Error('no paragraph text found — not an article page');
  }

  return {
    title,
    canonicalUrl: declaredCanonical(html, baseUrl),
    metadata: {
      title,
      published_at: metaContent(html, 'article:published_time') ?? metaContent(html, 'date'),
      author: metaContent(html, 'author'),
      language: html.match(/<html\b[^>]*\blang\s*=\s*"([^"]*)"/i)?.[1] ?? null,
    },
    text: paragraphs.map((paragraph) => paragraph.text).join('\n\n') + '\n',
    links: paragraphs.flatMap((paragraph) => paragraph.links),
  };
}

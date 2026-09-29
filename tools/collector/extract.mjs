// HTML extraction for the raw snapshot (G17.01.b). Parsing is tolerant
// regexes; the crawler (G17.02) reuses this same extraction unchanged — both
// for its article heuristic (paragraphCount) and through the snapshot writer —
// so a crawled page and a file:// fixture of the same HTML always produce the
// same text.md bytes. Everything here is deterministic: the same HTML must
// always produce the same text.md bytes, because content_hash dedup compares
// those bytes across pages (docs/24_web_collection.md «Пашпарт запісу
// (RawRecord)»: content_hash — дэдуплікацыя зместу).
//
// Corrupt input (empty document, missing <title>, no paragraph text) throws a
// named diagnostic with a stable `code`; the run loop records it in run_log
// and moves on. The crawler's heuristic treats `no-article-text` as a
// classification (the page is a menu or catalog — skipped), the rest as
// corrupt fetches (step failed).

function extractError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

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

// Attribute order inside an <img> tag varies, so each attribute is matched
// against the whole tag string (the metaContent idiom). The source resolves
// through the lazy-loading chain (G17.10): data-src first, then srcset, then
// the visible src — when data-src/srcset carries the real image, src is its
// decorative placeholder and never becomes a second photo. An img without a
// resolvable source is markup garbage, not a fetchable image — skipped
// entirely; a source that cannot resolve against the page URL is kept raw
// and fails later at load time with a diagnostic (the «broken image URL»
// case).
function extractImgTags(fragment, baseUrl) {
  const images = [];
  for (const tag of fragment.match(/<img\b[^>]*>/gi) ?? []) {
    const src = imgSource(tag);
    if (src === undefined || src.trim() === '') continue;
    const alt = tag.match(/\balt\s*=\s*"([^"]*)"/i)?.[1];
    const title = tag.match(/\btitle\s*=\s*"([^"]*)"/i)?.[1];
    let url;
    try {
      url = new URL(decodeEntities(src), baseUrl).href;
    } catch {
      url = decodeEntities(src);
    }
    images.push({
      url,
      alt: alt === undefined ? null : collapse(decodeEntities(alt)),
      caption: title === undefined ? null : collapse(decodeEntities(title)),
    });
  }
  return images;
}

// One attribute matched against the whole tag — attribute order varies. The
// plain src pattern would also match inside data-src, so the fallback carries
// a (?<!-) lookbehind guard, and the chain reads data-src and srcset first:
// the visible src loses to the real lazy source.
function imgSource(tag) {
  const dataSrc = tag.match(/\bdata-src\s*=\s*"([^"]*)"/i)?.[1];
  if (dataSrc !== undefined && dataSrc.trim() !== '') return dataSrc;
  const srcset = tag.match(/\bsrcset\s*=\s*"([^"]*)"/i)?.[1];
  if (srcset !== undefined && srcset.trim() !== '') {
    const url = largestSrcsetCandidate(srcset);
    if (url !== null) return url;
  }
  return tag.match(/\b(?<!-)src\s*=\s*"([^"]*)"/i)?.[1];
}

// srcset lists candidates with width (480w) or density (2x) descriptors; the
// largest is the real content image, a candidate without a descriptor counts
// as 1x, ties keep the earlier candidate. Known regex limitation: a comma
// inside a srcset URL splits it — the truncated URL then fails at load time
// with a diagnostic and the run continues.
function largestSrcsetCandidate(srcset) {
  const candidates = srcset
    .split(',')
    .map((part) => {
      const url = part.trim().split(/\s+/)[0];
      const descriptor = part.trim().slice(url.length).trim();
      const width = descriptor.match(/^(\d+)w$/i)?.[1];
      const density = descriptor.match(/^(\d+(?:\.\d+)?)x$/i)?.[1];
      return { url, score: width !== undefined ? Number(width) : density !== undefined ? Number(density) : 1 };
    })
    .filter((candidate) => candidate.url !== '');
  if (candidates.length === 0) return null;
  return candidates.reduce((best, candidate) => (candidate.score > best.score ? candidate : best)).url;
}

// Bare URLs written as plain text («Гл. https://example.org/museum») are
// links like anchored ones (docs/24_web_collection.md, «Пашпарт запісу
// (RawRecord)»: сырая копія захоўвае «спіс спасылак (тэкст-анкер + адрас +
// кантэкстны абзац)»): the address enters the links table — the anchor is
// the address itself, the context is the paragraph — and from the same rows
// the crawler frontier, while the text keeps the address visible as a
// markdown link. The pass runs after the anchor pass and skips existing
// [label](url) spans: an anchored link already covers the addresses in its
// own label and target, and re-wrapping them would nest the markdown and
// duplicate the row (a known regex limitation stands: a label holding both
// square brackets and a URL escapes the span). Scheme-less addresses
// («www.…», «example.org») never match — the pattern requires the http(s)://
// prefix.
const BARE_URL = /https?:\/\/[^\s<>"'[\]]+/gi;
const MARKDOWN_LINK = /\[[^\]]*\]\([^)]*\)/g;

function collectBareUrls(text, links) {
  let out = '';
  let at = 0;
  for (const span of text.matchAll(MARKDOWN_LINK)) {
    out += bareUrlSegment(text.slice(at, span.index), links) + span[0];
    at = span.index + span[0].length;
  }
  return out + bareUrlSegment(text.slice(at), links);
}

function bareUrlSegment(segment, links) {
  return segment.replace(BARE_URL, (match) => {
    const url = bareUrlToken(match);
    if (url === null) return match;
    links.push({ anchor: url, url });
    // The trimmed-off tail (a dot, an unbalanced parenthesis) is visible text
    // — it stays in the paragraph, after the link.
    return `[${url}](${url})` + match.slice(url.length);
  });
}

// Trailing sentence punctuation and an unbalanced closing parenthesis stay
// outside the address («(гл. https://example.org/x.)»), GFM-autolink style;
// a balanced «(…)» inside the address stays. A token still carrying an
// unbalanced «(» is left as plain text: its markdown wrapper would not
// render as a link and the visible paragraph would show raw markup.
// «https://» with nothing address-shaped after it is plain text too.
function bareUrlToken(match) {
  let url = match;
  for (;;) {
    if (/[.,;:!?]$/.test(url)) {
      url = url.slice(0, -1);
    } else if (url.endsWith(')') && (url.match(/\(/g) ?? []).length < (url.match(/\)/g) ?? []).length) {
      url = url.slice(0, -1);
    } else {
      break;
    }
  }
  if ((url.match(/\(/g) ?? []).length !== (url.match(/\)/g) ?? []).length) return null;
  return /^https?:\/\/./i.test(url) ? url : null;
}

export function extractPage(html, baseUrl) {
  if (typeof html !== 'string' || html.trim() === '') {
    throw extractError('empty-document', 'empty document — nothing to extract');
  }
  const rawTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = rawTitle === undefined ? null : collapse(decodeEntities(rawTitle));
  if (!title) {
    throw extractError('missing-title', 'missing <title> — the page cannot be identified');
  }

  // One document-order walk over paragraphs and standalone <figure> blocks,
  // plus the segments between them: an image standing directly in the page's
  // containers — outside <p> and <figure> (G17.10) — renders exactly where it
  // stood, so it follows the figure semantics (position = the count of
  // paragraphs collected so far). Images carry the index of the text.md block
  // they are placed before (media.position, docs/24_web_collection.md
  // «Фота»): an image inside a text paragraph renders after that paragraph's
  // text, a figure between paragraphs renders exactly where it stood. Known
  // regex limitation, unchanged by G17.02: <p> inside <figure> is not
  // extracted.
  const paragraphs = [];
  const images = [];
  const collectLooseImages = (segment) => {
    // Script, style and template bodies never render — an <img> written
    // inside them is code, not a page image. <noscript> repeats the very lazy
    // image it falls back for (the same address as data-src), so scanning it
    // would double every lazy photo.
    const visible = segment.replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    for (const image of extractImgTags(visible, baseUrl)) {
      image.position = paragraphs.length;
      images.push(image);
    }
  };
  const BLOCK = /<p\b[^>]*>[\s\S]*?<\/p>|<figure\b[^>]*>[\s\S]*?<\/figure>/gi;
  let cursor = 0;
  for (const match of html.matchAll(BLOCK)) {
    collectLooseImages(html.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    const block = match[0];
    const inner = block.slice(block.indexOf('>') + 1, block.lastIndexOf('<'));
    const isFigure = /^<figure/i.test(block);
    const blockImages = extractImgTags(inner, baseUrl);
    if (isFigure) {
      const caption = collapse(
        decodeEntities(
          (inner.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1] ?? '').replace(/<[^>]+>/g, '')
        )
      );
      for (const image of blockImages) {
        if (caption !== '') image.caption = caption;
        image.position = paragraphs.length;
        images.push(image);
      }
      continue;
    }
    const links = [];
    const text = collectBareUrls(
      collapse(
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
      ),
      links
    );
    for (const image of blockImages) {
      // Inside a text paragraph the image renders after its text — one block
      // further; an image-only paragraph renders where it stands.
      image.position = text === '' ? paragraphs.length : paragraphs.length + 1;
      images.push(image);
    }
    if (text !== '') {
      for (const link of links) link.context = text;
      paragraphs.push({ text, links });
    }
  }
  collectLooseImages(html.slice(cursor));
  if (paragraphs.length === 0) {
    throw extractError('no-article-text', 'no paragraph text found — not an article page');
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
    paragraphCount: paragraphs.length,
    text: paragraphs.map((paragraph) => paragraph.text).join('\n\n') + '\n',
    links: paragraphs.flatMap((paragraph) => paragraph.links),
    images,
  };
}

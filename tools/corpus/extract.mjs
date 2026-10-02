// G19.02 — offline wiki-html/v1 extraction (issue #459).
// One saved HTML file in, one schema-pinned ArticleDocument out — plus the
// inert list of original-image references the same DOM pass has already read
// (25 §4: «Спіс арыгіналаў у HTML чытаецца як даныя, без выканання скрыпта»).
// The document is what lands in the package as article.json; the reference
// list feeds the import report (written vs missing media) because the article
// schema deliberately has no field for originals that were never provided.
//
// The DOM pass runs through Playwright (25 §4): the injected browserFactory
// opens an isolated context with JavaScript disabled and every request
// aborted, and the page itself is never navigated — setContent only. Page
// scripts therefore cannot execute and no subresource can leave the process;
// extractArticle works on the parsed outline, never on evaluated content.
//
// Profile wiki-html/v1 (25 §4): title from #firstHeading (fallback <title>),
// content from #mw-content-text; toc/navbox/other navigation zones, scripts,
// styles, iframes, tables and inline icon images are excluded entirely; real
// headings become section_path; <br> survives as a newline and block
// boundaries as a blank line; figcaptions become caption fragments; reflist
// items become bibliography fragments. Fragments are cut at 6000 Unicode
// code points on sentence boundaries with the original whitespace kept as
// glue; a sentence longer than the limit is split at stable positions.
// Missing or ambiguous #mw-content-text yields unsupported_template without
// any silent fallback to the whole-page text. Identity is never resolved:
// person and family wording stays verbatim, no entity output exists here.
//
// Locator grammar (stable, globally unique per revision): body fragments
// `body[K]`, figure captions `figure[N]:caption`, bibliography items
// `bibliography:li[M]`, original figure images `figure[N]`, bare content
// images `img[M]`, anchors `p[P]:a[M]`. fragment_id is SHA-256 over the
// canonical JSON array [revision_id, extractor_version, source_locator].

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';

import { validateDocument } from './contracts.mjs';

// 25 §4: fragments up to 6000 Unicode code points; the schema's maxLength
// counts UTF-16 units, so the producer owns the limit.
export const FRAGMENT_LIMIT = 6000;

const HTML_BYTES_LIMIT = 20 * 1024 * 1024;

// Named diagnostic, not a thrown bare error: import and the CLI answer with
// rule + message and reject the record, never crash (implementation-rules 14).
export class CorpusDiagnostic extends Error {
  constructor(rule, message, details = {}) {
    super(message);
    this.name = 'CorpusDiagnostic';
    this.rule = rule;
    this.details = details;
  }
}

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

// Same dynamic-import seam as the collector's browser fetcher: a missing
// package or binary is a named diagnostic, never an automatic install.
async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    throw new CorpusDiagnostic(
      'playwright-missing',
      'playwright is not installed — the extraction profile needs: npm install && npx playwright install chromium'
    );
  }
}

// Each open() gives one isolated extraction context: JavaScript disabled,
// every request aborted before it reaches the network, no navigation. The
// caller records attempted requests and page errors to prove inertness.
export async function createExtractionBrowserFactory() {
  const playwright = await loadPlaywright();
  const executable = playwright.chromium.executablePath();
  if (!existsSync(executable)) {
    throw new CorpusDiagnostic(
      'chromium-missing',
      `chromium binary is missing at ${executable} — run: npx playwright install chromium`
    );
  }
  const browser = await playwright.chromium.launch({ headless: true });
  return {
    async open() {
      const context = await browser.newContext({ javaScriptEnabled: false });
      const attemptedRequests = [];
      await context.route('**/*', (route) => {
        attemptedRequests.push(route.request().url());
        return route.abort();
      });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(String(error)));
      return { page, attemptedRequests, pageErrors, close: () => context.close() };
    },
    close: () => browser.close(),
  };
}

// Runs inside the page via evaluate (no closure over this module): serializes
// the wiki-html/v1 outline as plain data. Navigation zones, scripts, styles,
// iframes and tables are dropped here; text is whitespace-collapsed per line
// with <br> kept as a hard newline.
function collectOutline() {
  const NAV_SELECTOR = '.toc, .navbox, .vertical-navbox, [role="navigation"], .mw-editsection, sup.reference, .mw-references-wrap';
  const SKIP_SELECTOR = 'script, style, template, iframe, table, noscript, svg';

  const heading = document.querySelector('#firstHeading');
  const containers = document.querySelectorAll('#mw-content-text');
  const blocks = [];

  const collapse = (text) => text.replace(/\s+/g, ' ').trim();

  // Inline walk of one paragraph: text nodes collapse, <br> closes a line,
  // anchors contribute their visible text and are recorded, inline markup
  // unwraps, icons (images inside a paragraph) leave no trace.
  function paragraphLines(element, links) {
    const lines = [];
    let line = '';
    const visit = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        line += node.nodeValue.replace(/\s+/g, ' ');
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName;
      if (tag === 'BR') {
        lines.push(line.trim());
        line = '';
        return;
      }
      if (tag === 'A') {
        const text = collapse(node.textContent);
        const href = node.getAttribute('href');
        // A visible-text anchor without an href (legacy <a name>) keeps its
        // text in the body but records no link: the schema requires a
        // non-empty target and there is no address to store.
        if (text && href) links.push({ text, href });
        line += text;
        return;
      }
      if (tag === 'IMG') return;
      if (SKIP_SELECTOR.split(', ').includes(tag.toLowerCase())) return;
      for (const child of node.childNodes) visit(child);
    };
    for (const child of element.childNodes) visit(child);
    lines.push(line.trim());
    return lines.filter((value, index) => value !== '' || (index > 0 && index < lines.length - 1));
  }

  function walk(element) {
    for (const child of element.childNodes) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      if (child.matches(NAV_SELECTOR)) continue;
      if (SKIP_SELECTOR.split(', ').includes(child.tagName.toLowerCase())) continue;
      if (child.classList.contains('reflist')) {
        for (const item of child.querySelectorAll('li')) {
          const text = collapse(item.textContent);
          if (text) blocks.push({ kind: 'refitem', text });
        }
        continue;
      }
      if (/^H[1-6]$/.test(child.tagName)) {
        blocks.push({ kind: 'heading', level: Number(child.tagName[1]), text: collapse(child.textContent) });
        continue;
      }
      if (child.tagName === 'P') {
        const links = [];
        const lines = paragraphLines(child, links);
        blocks.push({ kind: 'paragraph', lines, links });
        continue;
      }
      if (child.tagName === 'FIGURE') {
        const image = child.querySelector('img');
        const caption = child.querySelector('figcaption');
        blocks.push({
          kind: 'figure',
          src: image?.getAttribute('src') ?? null,
          alt: image?.getAttribute('alt') ?? null,
          caption: caption ? collapse(caption.textContent) : null,
        });
        continue;
      }
      if (child.tagName === 'IMG') {
        blocks.push({ kind: 'image', src: child.getAttribute('src'), alt: child.getAttribute('alt') });
        continue;
      }
      walk(child);
    }
  }

  if (containers.length === 1) walk(containers[0]);

  return {
    headingCount: document.querySelectorAll('#firstHeading').length,
    containerCount: containers.length,
    heading: heading ? collapse(heading.textContent) : null,
    pageTitle: document.title || null,
    blocks,
  };
}

function canonicalJsonArray(values) {
  return JSON.stringify(values);
}

function fragmentId(revisionId, extractorVersion, locator) {
  return sha256Hex(canonicalJsonArray([revisionId, extractorVersion, locator]));
}

// Sentence atoms keep their original glue (whitespace after the punctuation)
// so a packed fragment reproduces the paragraph text exactly; the blank line
// between blocks is a hard atom boundary and never merges.
function sentenceAtoms(paragraphText) {
  const atoms = [];
  const pattern = /([.!?…]["»')\]]?)(\s+)/gu;
  let start = 0;
  for (const match of paragraphText.matchAll(pattern)) {
    atoms.push({ text: paragraphText.slice(start, match.index + match[1].length), glue: match[2] });
    start = match.index + match[1].length + match[2].length;
  }
  atoms.push({ text: paragraphText.slice(start), glue: '' });
  return atoms.filter((atom) => atom.text !== '');
}

const CODE_POINTS = (text) => Array.from(text).length;

// Cuts a text into ≤ limit code point pieces at the last space of each
// window (hard cut when a window has none) — stable positions for the same
// input, per 25 §4. Every fragment kind shares this limit.
function chunkTexts(text) {
  const pieces = [];
  let rest = text;
  while (CODE_POINTS(rest) > FRAGMENT_LIMIT) {
    const chars = Array.from(rest);
    const window = chars.slice(0, FRAGMENT_LIMIT + 1).join('');
    const cut = window.lastIndexOf(' ');
    const at = cut > 0 ? cut : FRAGMENT_LIMIT;
    pieces.push(chars.slice(0, at).join('').trimEnd());
    rest = chars.slice(at).join('').trimStart();
  }
  pieces.push(rest);
  return pieces;
}

// Splits one oversize sentence atom into ≤ limit pieces; only the last piece
// keeps the atom's original glue.
function splitOversizeAtom(atom) {
  const pieces = chunkTexts(atom.text);
  return pieces.map((text, index) => ({ text, glue: index === pieces.length - 1 ? atom.glue : ' ' }));
}

// Packs the section stream into fragments ≤ 6000 code points: sentences stay
// whole when they fit, block boundaries (the '\n\n' atoms) stay intact.
function packBodyFragments(streamText, sectionPath) {
  const fragments = [];
  if (streamText === '') return fragments;
  const paragraphs = streamText.split('\n\n');
  const atoms = [];
  for (const [index, paragraphText] of paragraphs.entries()) {
    for (const atom of sentenceAtoms(paragraphText)) atoms.push(atom);
    if (index < paragraphs.length - 1) atoms.push({ text: '', glue: '\n\n', boundary: true });
  }
  const chunks = [];
  for (const atom of atoms) {
    if (CODE_POINTS(atom.text) > FRAGMENT_LIMIT) chunks.push(...splitOversizeAtom(atom));
    else chunks.push(atom);
  }

  let current = '';
  let currentPoints = 0;
  const emit = () => {
    const text = current.trim();
    if (text !== '') fragments.push({ text, sectionPath });
    current = '';
    currentPoints = 0;
  };
  for (const chunk of chunks) {
    const extra = chunk.boundary ? 0 : CODE_POINTS(chunk.text) + CODE_POINTS(chunk.glue);
    if (currentPoints + extra > FRAGMENT_LIMIT && current.trim() !== '') emit();
    if (chunk.boundary) {
      if (current.trim() !== '') emit();
      continue;
    }
    current += chunk.text + chunk.glue;
    currentPoints += extra;
  }
  emit();
  return fragments;
}

function renderMarkdown(document) {
  const lines = [`# ${document.title}`, ''];
  let emittedPath = [];
  for (const fragment of document.fragments) {
    let shared = 0;
    while (
      shared < emittedPath.length &&
      shared < fragment.section_path.length &&
      emittedPath[shared] === fragment.section_path[shared]
    ) {
      shared += 1;
    }
    for (let depth = shared; depth < fragment.section_path.length; depth += 1) {
      lines.push(`${'#'.repeat(depth + 2)} ${fragment.section_path[depth]}`, '');
    }
    emittedPath = fragment.section_path;
    if (fragment.kind === 'caption') lines.push(`*${fragment.text}*`, '');
    else if (fragment.kind === 'bibliography') lines.push(`- ${fragment.text}`);
    else lines.push(fragment.text, '');
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return `${lines.join('\n')}\n`;
}

// htmlBytes in → { document, imageRefs } out. The document is schema-validated
// before return; imageRefs are inert strings read from the same outline.
export async function extractArticle(htmlBytes, { articleId, revisionId, extractorVersion, browserFactory }) {
  if (!(htmlBytes instanceof Uint8Array)) {
    throw new CorpusDiagnostic('html-not-bytes', 'html input must be raw bytes');
  }
  if (htmlBytes.byteLength > HTML_BYTES_LIMIT) {
    throw new CorpusDiagnostic('html-too-large', `html exceeds the ${HTML_BYTES_LIMIT} byte limit`);
  }
  let html;
  try {
    html = new TextDecoder('utf-8', { fatal: true }).decode(htmlBytes);
  } catch {
    throw new CorpusDiagnostic('html-not-utf8', 'html input is not valid UTF-8');
  }
  if (!/^[a-z][a-z0-9-]*\/v[0-9]+$/.test(extractorVersion)) {
    throw new CorpusDiagnostic('invalid-extractor-version', `extractor version '${extractorVersion}' does not match the profile pattern`);
  }
  if (!browserFactory || typeof browserFactory.open !== 'function') {
    throw new CorpusDiagnostic('browser-factory-missing', 'a browserFactory with open() is required for the DOM pass');
  }

  const session = await browserFactory.open();
  let outline;
  try {
    await session.page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    outline = await session.page.evaluate(collectOutline);
  } finally {
    await session.close();
  }

  const unsupported = outline.containerCount !== 1;
  const title = outline.heading ?? outline.pageTitle;
  if (!title) throw new CorpusDiagnostic('title-not-found', 'neither #firstHeading nor <title> produced a title');

  const fragments = [];
  const links = [];
  const imageRefs = [];
  const sectionPath = [];
  const sectionStack = [];
  let paragraphStream = '';
  let figureIndex = 0;
  let imageIndex = 0;
  let bibliographyIndex = 0;
  let bodyIndex = 0;
  let paragraphIndex = 0;

  const flushBody = () => {
    for (const packed of packBodyFragments(paragraphStream, [...sectionPath])) {
      bodyIndex += 1;
      const source_locator = `body[${bodyIndex}]`;
      fragments.push({
        fragment_id: fragmentId(revisionId, extractorVersion, source_locator),
        article_id: articleId,
        revision_id: revisionId,
        extractor_version: extractorVersion,
        kind: 'body',
        section_path: packed.sectionPath,
        text: packed.text,
        source_locator,
      });
    }
    paragraphStream = '';
  };

  for (const block of outline.blocks) {
    if (block.kind === 'heading') {
      flushBody();
      while (sectionStack.length > 0 && sectionStack[sectionStack.length - 1].level >= block.level) sectionStack.pop();
      sectionStack.push({ level: block.level, text: block.text });
      sectionPath.splice(0, sectionPath.length, ...sectionStack.map((entry) => entry.text));
      continue;
    }
    if (block.kind === 'paragraph') {
      const text = block.lines.join('\n');
      if (text === '') continue;
      if (paragraphStream !== '') paragraphStream += '\n\n';
      paragraphStream += text;
      paragraphIndex += 1;
      // Anchors are recorded with the paragraph they live in; navigation
      // zones never reach this point, and icon anchors have no visible text.
      for (const [index, link] of block.links.entries()) {
        links.push({
          visible_text: link.text,
          target: link.href,
          source_locator: `p[${paragraphIndex}]:a[${index + 1}]`,
        });
      }
      continue;
    }
    if (block.kind === 'figure' || block.kind === 'image') {
      flushBody();
      if (block.kind === 'figure') {
        figureIndex += 1;
        if (block.src) imageRefs.push({ reference: block.src, locator: `figure[${figureIndex}]` });
        if (block.caption) {
          for (const [chunkIndex, chunkText] of chunkTexts(block.caption).entries()) {
            const source_locator = `figure[${figureIndex}]:caption${chunkIndex > 0 ? `:c[${chunkIndex + 1}]` : ''}`;
            fragments.push({
              fragment_id: fragmentId(revisionId, extractorVersion, source_locator),
              article_id: articleId,
              revision_id: revisionId,
              extractor_version: extractorVersion,
              kind: 'caption',
              section_path: [...sectionPath],
              text: chunkText,
              source_locator,
            });
          }
        }
      } else if (block.src) {
        imageIndex += 1;
        imageRefs.push({ reference: block.src, locator: `img[${imageIndex}]` });
      }
      continue;
    }
    if (block.kind === 'refitem') {
      flushBody();
      bibliographyIndex += 1;
      for (const [chunkIndex, chunkText] of chunkTexts(block.text).entries()) {
        const source_locator = `bibliography:li[${bibliographyIndex}]${chunkIndex > 0 ? `:c[${chunkIndex + 1}]` : ''}`;
        fragments.push({
          fragment_id: fragmentId(revisionId, extractorVersion, source_locator),
          article_id: articleId,
          revision_id: revisionId,
          extractor_version: extractorVersion,
          kind: 'bibliography',
          section_path: [...sectionPath],
          text: chunkText,
          source_locator,
        });
      }
    }
  }
  flushBody();

  const document = {
    article_id: articleId,
    revision_id: revisionId,
    extractor_version: extractorVersion,
    title,
    ...(unsupported ? { unsupported_template: true } : {}),
    fragments,
    ...(links.length > 0 ? { links } : {}),
  };
  const verdict = validateDocument('article-fragment-v1', document);
  if (!verdict.ok) {
    throw new CorpusDiagnostic('document-invalid', 'extracted document failed the article schema', {
      errors: verdict.errors,
    });
  }
  return { document, imageRefs };
}

export { renderMarkdown };

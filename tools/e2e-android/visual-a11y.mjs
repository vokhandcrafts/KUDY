// DQ-06 (issue #916) — accessibility facts measured from the uiautomator
// dump, feeding the visual:check report (spec §5, §6.2, §6.4).
//
// Two rules run over every clickable node of a captured surface's dump:
//
//   RULE     a clickable node with no text and no content-desc (its own or
//            any descendant's — TalkBack reads the subtree of a container)
//            violates canon §9 «screen-reader подпісы на кожнай icon-only
//            кнопцы» (docs/design/visual-language.md §9). Blocks.
//   OPINION  a clickable node whose effective touch target is smaller than
//            48×48 dp. The 48 dp target is NOT a canon rule yet (spec §12,
//            question 4 — the owner decision is open), so it never blocks.
//
// The dump cannot see hitSlop — the visible rectangle is smaller than the
// real target (exceptions.md, `hitSlop`). The registry below reads the
// `hitSlop={…}` props from the app sources at run time and binds each to
// dump nodes through the RN testID (the dump's resource-id), in three
// forms: a literal testID on the same tag (`testID="link-guides"`), a
// template-literal prefix (`testID={`place-moment-resume-${id}`}`), and a
// testID prop variable resolved through the same-file call sites
// (`SurfaceLink` in app/(tabs)/explore.tsx). Nothing is hand-maintained:
// a new hitSlop site is picked up on the next run, and a site that cannot
// be bound is reported NOT-VERIFIED, never silently ignored
// (implementation-rules 14).
import fs from 'node:fs';
import path from 'node:path';

import { parseAttributes, parseNodeTag } from './driver.mjs';

// The spec §12 decision is open: 48 dp is measured and reported as OPINION.
export const MIN_TARGET_DP = 48;

const EPS = 1e-6;

// "[x1,y1][x2,y2]" → rectangle in px; null when the bounds are unreadable.
export function parseBounds(bounds) {
  const match = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(bounds ?? '');
  if (!match) return null;
  const x1 = Number(match[1]);
  const y1 = Number(match[2]);
  const x2 = Number(match[3]);
  const y2 = Number(match[4]);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

// One clickable node with its accessible name: the node's own text /
// content-desc, or — when the clickable container itself is unnamed — the
// union of its descendants' text and content-desc (TalkBack reads the
// subtree of a container, so a text child names the button).
export function parseA11yTree(xml) {
  if (typeof xml !== 'string') {
    return { clickable: [], diagnostics: ['дамп — не радок, чытаць нічога'] };
  }
  const diagnostics = [];
  const clickable = [];
  const stack = [];
  const ownParts = (attrs) =>
    [attrs.text ?? '', attrs['content-desc'] ?? ''].map((value) => value.trim()).filter(Boolean);
  let pos = 0;
  for (;;) {
    const lt = xml.indexOf('<', pos);
    if (lt === -1) break;
    if (xml.startsWith('</node', lt)) {
      const gt = xml.indexOf('>', lt);
      if (gt === -1) {
        diagnostics.push('незачынены </node');
        break;
      }
      pos = gt + 1;
      const frame = stack.pop();
      if (!frame) {
        diagnostics.push(`</node без адчыненага node на пазіцыі ${lt}`);
        continue;
      }
      const parts = [...ownParts(frame.attrs), ...frame.childParts];
      const top = stack[stack.length - 1];
      if (top) top.childParts.push(...parts);
      if (frame.attrs.clickable === 'true') {
        clickable.push(frameNode(frame.attrs, parts));
      }
      continue;
    }
    if (!xml.startsWith('<node', lt)) {
      pos = lt + 1; // <?xml …?>, <hierarchy …> — not dump nodes
      continue;
    }
    const tagBody = parseNodeTag(xml, lt + 5);
    if (tagBody === null) {
      diagnostics.push(`незачынены <node на пазіцыі ${lt}`);
      break;
    }
    pos = lt + 5 + tagBody.length + 1;
    const attrs = parseAttributes(tagBody);
    if (tagBody.endsWith('/')) {
      const parts = ownParts(attrs);
      const top = stack[stack.length - 1];
      if (top) top.childParts.push(...parts);
      if (attrs.clickable === 'true') clickable.push(frameNode(attrs, parts));
    } else {
      stack.push({ attrs, childParts: [] });
    }
  }
  if (stack.length > 0) diagnostics.push(`узлоў без закрывальнага тэга: ${stack.length}`);
  return { clickable, diagnostics };
}

function frameNode(attrs, parts) {
  return {
    resourceId: attrs['resource-id'] ?? '',
    cls: attrs.class ?? '',
    bounds: attrs.bounds ?? '',
    name: parts.join(' '),
  };
}

const nodeDesc = (node) =>
  `${node.resourceId || '(без resource-id)'} ${node.cls} ${node.bounds}`;

// ---------- hitSlop from code ----------

// `12` → all four sides; `{{ top: 4, bottom: 4 }}` → per side; anything
// else (including garbage) → null, which the report surfaces as
// NOT-VERIFIED instead of guessing (implementation-rules 14).
export function parseHitSlopValue(body) {
  const trimmed = body.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    return { top: n, right: n, bottom: n, left: n };
  }
  if (trimmed.startsWith('{')) {
    const sides = {};
    for (const [, side, num] of trimmed.matchAll(/(top|right|bottom|left)\s*:\s*(-?\d+(?:\.\d+)?)/g)) {
      sides[side] = Number(num);
    }
    if (Object.keys(sides).length > 0) return { top: 0, right: 0, bottom: 0, left: 0, ...sides };
  }
  return null;
}

// Body of `hitSlop={…}` starting right after the opening brace; one brace
// nesting level is honoured (the `{{ … }}` object form).
function readBraced(code, start) {
  let depth = 1;
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(start, i);
    }
  }
  return null;
}

// The JSX opening tag around `hitSlop`, without the leading `<`: quote-
// and brace-aware, because attribute expressions may contain `>`.
function enclosingTagBody(code, hitIndex) {
  const open = code.lastIndexOf('<', hitIndex);
  if (open === -1) return null;
  let inQuote = false;
  let depth = 0;
  for (let i = open + 1; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '"') inQuote = !inQuote;
    if (inQuote) continue;
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (ch === '>' && depth <= 0) return code.slice(open + 1, i);
  }
  return null;
}

const lineAt = (code, index) => code.slice(0, index).split('\n').length;

// End of a `function Name(…) {…}` body. The body-opening brace is the first
// `{` outside the parameter parentheses (TypeScript destructuring and type
// annotations live inside them); the end is its matching `}`. A shape this
// cannot read (e.g. an inline object return type) yields -1 → no binding,
// which surfaces as NOT-VERIFIED instead of a guess.
function functionBodyEnd(code, declIndex) {
  let parenDepth = 0;
  let openBrace = -1;
  for (let i = declIndex; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '(') parenDepth += 1;
    else if (ch === ')') parenDepth -= 1;
    else if (ch === '{' && parenDepth === 0) {
      openBrace = i;
      break;
    }
  }
  if (openBrace === -1) return -1;
  let depth = 0;
  for (let i = openBrace; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// `testID={testID}` — resolve the prop variable through the call sites of
// the nearest `function Name(` whose body actually contains the tag (an
// arrow component outside every declaration must not inherit a foreign
// function's call sites — that would grant hitSlop credit to a node the
// code never slops). No enclosing declaration → no binding.
function callSiteTestIDs(code, tagIndex) {
  const decl = /function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let name = null;
  for (const match of code.slice(0, tagIndex).matchAll(decl)) {
    const bodyEnd = functionBodyEnd(code, match.index);
    if (bodyEnd !== -1 && tagIndex < bodyEnd) name = match[1]; // nearest enclosing
  }
  if (!name) return [];
  const ids = [];
  for (const usage of code.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))) {
    const literal = /(?:^|\s)testID="([^"]*)"/.exec(usage[0]);
    if (literal) ids.push(literal[1]);
  }
  return ids;
}

// Bind the tag's testID to dump resource-ids: literal → exact match;
// template → its static head as a prefix; identifier → same-file call
// sites. No binding → testID and testIDPrefix stay null (NOT-VERIFIED).
function bindTestID(tagBody, code, tagStart) {
  const literal = /(?:^|\s)testID="([^"]*)"/.exec(tagBody);
  if (literal) return { testID: literal[1], testIDPrefix: null };
  const template = /(?:^|\s)testID=\{`([^`]*)`\}/.exec(tagBody);
  if (template) {
    const head = template[1].split('${')[0];
    return { testID: null, testIDPrefix: head.length > 0 ? head : null };
  }
  const ident = /(?:^|\s)testID=\{([A-Za-z_$][\w$]*)\}/.exec(tagBody);
  if (ident) {
    const ids = callSiteTestIDs(code, tagStart);
    if (ids.length > 0) return { testIDs: ids, testID: null, testIDPrefix: null };
  }
  return { testID: null, testIDPrefix: null };
}

// Scan sources (`[{ file, code }]`) for `hitSlop={…}` and bind each to the
// testIDs the dump can name. One entry per bound testID; one unbound entry
// when the binding fails.
export function readHitSlops(sources) {
  const entries = [];
  for (const { file, code } of sources) {
    if (typeof code !== 'string' || !code.includes('hitSlop')) continue;
    for (const match of code.matchAll(/hitSlop=\{/g)) {
      const line = lineAt(code, match.index);
      const source = `${file}:${line}`;
      const body = readBraced(code, match.index + 'hitSlop={'.length);
      const slop = body === null ? null : parseHitSlopValue(body);
      const tagBody = enclosingTagBody(code, match.index);
      let bound = { testID: null, testIDPrefix: null };
      if (tagBody !== null) bound = bindTestID(tagBody, code, match.index);
      if (bound.testIDs) {
        for (const testID of bound.testIDs) entries.push({ testID, testIDPrefix: null, slop, source });
      } else {
        entries.push({ testID: bound.testID, testIDPrefix: bound.testIDPrefix, slop, source });
      }
    }
  }
  return entries;
}

// The slop of one dump node: exact testID match first, then the longest
// template prefix; no match → null (no hitSlop credit).
export function hitSlopForId(resourceId, registry) {
  if (!resourceId) return null;
  let best = null;
  for (const entry of registry) {
    if (entry.slop === null) continue;
    if (entry.testID !== null && entry.testID === resourceId) return entry.slop;
    if (entry.testIDPrefix !== null && resourceId.startsWith(entry.testIDPrefix)) {
      if (best === null || entry.testIDPrefix.length > best.testIDPrefix.length) best = entry;
    }
  }
  return best === null ? null : best.slop;
}

// ---------- the measured findings (spec §6.2, §6.4) ----------

const dp = (px, pxPerDp) => Number((px / pxPerDp).toFixed(1));

// Every clickable node yields at most one finding: RULE for a missing
// accessible name (the blocking violation), otherwise OPINION when the
// effective target misses 48 dp. `pxPerDp` null disables the size check —
// the caller reports that as NOT-VERIFIED once per dump.
export function checkA11y({ clickable, pxPerDp, registry, dumpName }) {
  const findings = [];
  for (const node of clickable) {
    if (node.name === '') {
      findings.push({
        class: 'RULE',
        node: nodeDesc(node),
        rule: 'docs/design/visual-language.md §9 «screen-reader подпісы на кожнай icon-only кнопцы»',
        measured: 'тэкст і content-desc пустыя — у элемента і яго нашчадкаў',
        requires: 'content-desc альбо тэкст на клікабельным элементе',
        evidence: `${dumpName}; ${nodeDesc(node)}`,
      });
      continue;
    }
    if (pxPerDp === null || !Number.isFinite(pxPerDp) || pxPerDp <= 0) continue;
    const rect = parseBounds(node.bounds);
    if (rect === null) {
      findings.push({
        class: 'NOT-VERIFIED',
        node: nodeDesc(node),
        rule: null,
        measured: null,
        requires: 'чытэльныя bounds у дампе',
        evidence: `${dumpName}; ${nodeDesc(node)}`,
      });
      continue;
    }
    const slop = hitSlopForId(node.resourceId, registry) ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const effWidthPx = rect.width + (slop.left + slop.right) * pxPerDp;
    const effHeightPx = rect.height + (slop.top + slop.bottom) * pxPerDp;
    const minPx = MIN_TARGET_DP * pxPerDp;
    if (effWidthPx < minPx - EPS || effHeightPx < minPx - EPS) {
      findings.push({
        class: 'OPINION',
        node: nodeDesc(node),
        rule: '48 dp — не правіла канона; спец design-QA §12, пытанне 4 (рашэнне ўладальніка адкрытае)',
        measured:
          `бачная мішэнь ${dp(rect.width, pxPerDp)}×${dp(rect.height, pxPerDp)} dp, ` +
          `эфектыўная з hitSlop ${dp(effWidthPx, pxPerDp)}×${dp(effHeightPx, pxPerDp)} dp`,
        requires: `эфектыўная мішэнь ≥ ${MIN_TARGET_DP} dp — і рашэнне ўладальніка пра правіла`,
        evidence: `${dumpName}; ${nodeDesc(node)}`,
      });
    }
  }
  return findings;
}

// ---------- source scan (the registry's input) ----------

const SOURCE_DIRS = ['app', 'components'];

function listFilesRecursive(root, dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(root, full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(path.relative(root, full));
    }
  }
  return out;
}

// Every app-side source that may carry hitSlop, in a stable order. Test
// files never carry production hitSlop; excluding them keeps the registry
// free of test scaffolding.
export function listHitSlopSources(repoRoot) {
  const files = [];
  for (const dir of SOURCE_DIRS) {
    const full = path.join(repoRoot, dir);
    if (fs.existsSync(full)) files.push(...listFilesRecursive(repoRoot, full));
  }
  return files
    .map((file) => ({ file, code: fs.readFileSync(path.join(repoRoot, file), 'utf8') }))
    .filter(({ code }) => code.includes('hitSlop'));
}

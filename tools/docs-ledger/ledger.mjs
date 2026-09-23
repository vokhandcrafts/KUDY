// The docs fact ledger (G18.05): a deterministic extraction of the facts that
// exist in docs/ — requirement/decision IDs, backticked identifiers, §
// citations, relative link targets and headings of the normative files.
// `ledger:baseline` freezes the set into baseline.json; `ledger:check` fails
// while any frozen item is neither present in docs/ nor consciously recorded
// in dropped.json. Policy lives in tools/docs-ledger/README.md.
import fs from 'node:fs';
import path from 'node:path';

export const KINDS = ['id', 'code', 'section', 'link', 'heading'];

// docs/human-actions.md is a transient log by design: its entries are removed
// as the human confirms them (docs/agent-rules/issue-workflow.md), so items
// frozen from it would churn on every confirmed action. It stays out of the
// scan; the rest of docs/ is scanned in full.
const EXCLUDED_FILES = new Set(['docs/human-actions.md']);

// Files whose headings are ledger items (the "normative files" of G18.05
// criterion 2 — the owner files the ownership map in docs/readme.md points
// to): the numbered product/architecture docs, the accepted ADRs and the
// run-model contract.
const NORMATIVE_PATTERNS = [
  /^docs\/\d{2}_.+\.md$/,
  /^docs\/architecture\/\d{2}_.+\.md$/,
  /^docs\/architecture\/decisions\/.+\.md$/,
  /^docs\/run-model\/README\.md$/,
];

const ID_PATTERNS = [
  /\bG\d{2}\.\d{2}(?:\.[a-z])?\b/g,
  /\b(?:R|P|D)\d{2}\b/g,
  /\b(?:TR|AR)-\d+\b/g,
];
const CODE_SPAN = /`([^`\n]+)`/g;
const SECTION_REF = /(\b\d{2})?[ \t]*§[ \t]*(\d+(?:\.\d+)*)/g;
const INLINE_LINK = /\[[^\]\n]*\]\(([^)\s]+)\)/g;
const ATX_HEADING = /^#{1,6}\s+(.+?)(?:\s+#+)?[ \t]*$/;

export function isNormativeFile(relPath) {
  return NORMATIVE_PATTERNS.some((pattern) => pattern.test(relPath));
}

export function itemKey(item) {
  if (item.kind === 'heading') return `heading\u0000${item.file}\u0000${item.value}`;
  return `${item.kind}\u0000${item.value}`;
}

export function listMarkdownFiles(docsDir) {
  const out = [];
  const walk = (abs, rel) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      const absPath = path.join(abs, entry.name);
      if (entry.isDirectory()) walk(absPath, relPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(relPath);
    }
  };
  walk(docsDir, '');
  return out.sort();
}

// Fenced blocks are stripped only where code spans and headings are read: a
// fenced JSON sample is not an identifier, and a `#` comment line inside one
// is not a heading. IDs, § citations and links are read from the full text —
// a fact stated inside a fenced sample is still a fact.
function stripFences(text) {
  const out = [];
  let fenceMarker = null;
  for (const line of text.split('\n')) {
    const opens = line.match(/^(```|~~~)/);
    if (opens) {
      if (!fenceMarker) fenceMarker = opens[1];
      else if (line.startsWith(fenceMarker)) fenceMarker = null;
      out.push('');
      continue;
    }
    out.push(fenceMarker ? '' : line);
  }
  return out.join('\n');
}

// A link target becomes a repo-relative POSIX path; pure anchors, external
// URLs and query-only targets are not target facts. The fragment is dropped —
// for normative files the heading itself is the tracked fact.
export function resolveLinkTarget(fromFile, target) {
  let clean = target.split('#')[0].split('?')[0].trim();
  if (!clean || /^(https?:|mailto:|\/\/)/i.test(clean)) return null;
  clean = clean.split('\\').join('/');
  const fromDir = path.posix.dirname(fromFile);
  return path.posix.normalize(path.posix.join(fromDir, clean));
}

export function extractItems() {
  // Ledger identities are repo-relative paths with the `docs/` prefix (the
  // same convention the CLIs use for their fixed paths), so the extraction
  // always reads the `docs/` directory next to the current working directory.
  const items = new Map();
  const add = (item) => {
    const key = itemKey(item);
    if (!items.has(key)) items.set(key, item);
  };
  for (const rel of listMarkdownFiles('docs')) {
    const fullRel = `docs/${rel}`;
    if (EXCLUDED_FILES.has(fullRel)) continue;
    const abs = path.join('docs', rel.split('/').join(path.sep));
    const text = fs.readFileSync(abs, 'utf8').replace(/\r\n?/g, '\n');
    const noFences = stripFences(text);
    for (const pattern of ID_PATTERNS) {
      for (const m of text.matchAll(pattern)) add({ kind: 'id', value: m[0] });
    }
    for (const m of noFences.matchAll(CODE_SPAN)) {
      const value = m[1].trim();
      // Pure-punctuation spans (`..`, `||`, `''`) are typographic fragments,
      // not identifiers; a span is a fact only if it names something.
      if (value.length >= 2 && /[A-Za-z0-9]/.test(value)) add({ kind: 'code', value });
    }
    for (const m of text.matchAll(SECTION_REF)) {
      add({ kind: 'section', value: (m[1] ? `${m[1]} ` : '') + `§${m[2]}` });
    }
    for (const m of text.matchAll(INLINE_LINK)) {
      const resolved = resolveLinkTarget(fullRel, m[1]);
      if (resolved) add({ kind: 'link', value: resolved });
    }
    if (isNormativeFile(fullRel)) {
      for (const line of noFences.split('\n')) {
        const h = line.match(ATX_HEADING);
        if (h) add({ kind: 'heading', value: h[1].replace(/\s+/g, ' ').trim(), file: fullRel });
      }
    }
  }
  return items;
}

export function validateBaseline(baseline) {
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) {
    throw new Error('baseline must be a JSON object of shape { generated, items }');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baseline.generated ?? '')) {
    throw new Error('baseline "generated" must be a YYYY-MM-DD date');
  }
  if (!Array.isArray(baseline.items)) {
    throw new Error('baseline has no "items" array (expected { generated, items })');
  }
  baseline.items.forEach((item, i) => {
    const where = `baseline item #${i}`;
    if (!KINDS.includes(item.kind)) throw new Error(`${where}: unknown kind ${JSON.stringify(item.kind)}`);
    if (typeof item.value !== 'string' || item.value.length === 0) throw new Error(`${where}: "value" must be a non-empty string`);
    if (item.kind === 'heading' && typeof item.file !== 'string') throw new Error(`${where}: heading item needs a "file"`);
  });
}

// Every dropped entry needs a reason and either a replacement link or the
// commit SHA of the original — an unexplained drop is not a drop, it is a
// silent loss.
export function validateDropped(dropped) {
  if (!dropped || typeof dropped !== 'object' || Array.isArray(dropped)) {
    throw new Error('dropped.json must be a JSON object of shape { entries }');
  }
  if (!Array.isArray(dropped.entries)) {
    throw new Error('dropped.json has no "entries" array (expected { entries })');
  }
  dropped.entries.forEach((entry, i) => {
    const where = `dropped entry #${i}`;
    if (!KINDS.includes(entry.kind)) throw new Error(`${where}: unknown kind ${JSON.stringify(entry.kind)}`);
    if (typeof entry.value !== 'string' || entry.value.length === 0) throw new Error(`${where}: "value" must be a non-empty string`);
    if (entry.kind === 'heading' && typeof entry.file !== 'string') throw new Error(`${where}: heading entry needs a "file"`);
    if (typeof entry.reason !== 'string' || entry.reason.length === 0) throw new Error(`${where} (${entry.value}): "reason" is required`);
    if (!entry.replacement && !entry.sha) {
      throw new Error(`${where} (${entry.value}): a drop needs a "replacement" link or the commit "sha" of the original`);
    }
  });
}

export function droppedKeys(dropped) {
  validateDropped(dropped);
  return new Set(dropped.entries.map((entry) => itemKey(entry)));
}

// An item is lost when it is present neither in the current docs/ tree nor in
// dropped.json. For link targets the referent file still existing on disk
// counts as present: losing a redundant pointer is not losing the fact it
// pointed at.
export function checkLedger({ baseline, dropped, repoRoot }) {
  validateBaseline(baseline);
  const covered = droppedKeys(dropped);
  const current = extractItems();
  const lost = [];
  for (const item of baseline.items) {
    if (current.has(itemKey(item))) continue;
    if (item.kind === 'link' && fs.existsSync(path.join(repoRoot, item.value))) continue;
    if (covered.has(itemKey(item))) continue;
    lost.push(item);
  }
  return { lost, baselineCount: baseline.items.length, currentCount: current.size, coveredCount: covered.size };
}

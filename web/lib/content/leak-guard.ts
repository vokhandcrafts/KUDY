// Independent verification that the tree the web is pointed at is public-only.
// The build-bundle guard already stops leaks at assembly; this one re-checks
// the actual input the web build consumes, with the same error classes:
//   private-path-in-public  — a private/extended/../-like segment in a tree
//                             path or in a path-typed JSON string
//   source-map-in-public    — a *.map file in the public input
//   private-text-leak       — an 8-word n-gram of private narration (09 §3
//                             text/transcript) found in a public JSON string
//   invalid-json            — an unparseable file cannot be verified
// Build-time only (node:fs). scanRenderedOutput below extends the same classes
// to the rendered static export (G10.01.b step 6).
import fs from 'node:fs';
import path from 'node:path';

export type ViolationCode =
  | 'private-path-in-public'
  | 'source-map-in-public'
  | 'private-text-leak'
  | 'invalid-json';

export interface Violation {
  code: ViolationCode;
  path: string;
}

export interface ScanResult {
  ok: boolean;
  violations: Violation[];
}

const GRAM_LENGTH = 8;

function unsafeSegments(relPath: string): boolean {
  const normalized = relPath.replaceAll('\\', '/');
  return normalized.split('/').some((seg) => seg === '' || seg === '.' || seg === '..' || seg === 'private' || seg === 'extended');
}

function listFiles(root: string): { abs: string; rel: string }[] {
  if (!fs.existsSync(root)) return [];
  const rootAbs = fs.realpathSync(root);
  const out: { abs: string; rel: string }[] = [];
  for (const entry of fs.readdirSync(rootAbs, { withFileTypes: true, recursive: true })) {
    // Walk boundary: regular files of the tree only. Links are never read
    // through, and since recursive readdir may descend into directory
    // symlinks and yield their files as plain entries, every result is
    // re-pinned to the scan root's real path — nothing outside the tree is
    // ever read. An in-root entry with an unsafe rel is still yielded, so
    // the scans below can REPORT it, never silently lose it.
    if (entry.isSymbolicLink() || !entry.isFile()) continue;
    const abs = path.resolve(entry.parentPath, entry.name);
    const real = fs.realpathSync(abs);
    if (real !== rootAbs && !real.startsWith(rootAbs + path.sep)) continue;
    out.push({ abs, rel: path.relative(rootAbs, abs) });
  }
  return out;
}

function walkStrings(value: unknown, visit: (s: string, key: string) => void, key = ''): void {
  if (typeof value === 'string') {
    visit(value, key);
  } else if (Array.isArray(value)) {
    for (const item of value) walkStrings(item, visit, key);
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walkStrings(v, visit, k);
  }
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0);
}

function eightGrams(tokens: string[]): string[] {
  const grams: string[] = [];
  for (let i = 0; i + GRAM_LENGTH <= tokens.length; i++) {
    grams.push(tokens.slice(i, i + GRAM_LENGTH).join(' '));
  }
  return grams;
}

// Private narration grams: the paid text and transcript fields of the private
// tree (09 §3 — the fields the public layer must never share wording with).
function privateGrams(privateDir: string): Set<string> {
  const grams = new Set<string>();
  for (const { abs } of listFiles(privateDir)) {
    if (!abs.endsWith('.json')) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch {
      continue;
    }
    walkStrings(doc, (value, key) => {
      if (key === 'text' || key === 'transcript') {
        for (const gram of eightGrams(tokenize(value))) grams.add(gram);
      }
    });
  }
  return grams;
}

export function scanWebContentInput({ publicDir, privateDir }: { publicDir: string; privateDir?: string }): ScanResult {
  const violations: Violation[] = [];
  const grams = privateDir ? privateGrams(privateDir) : null;
  for (const { abs, rel } of listFiles(publicDir)) {
    if (abs.endsWith('.map')) {
      violations.push({ code: 'source-map-in-public', path: rel });
      continue;
    }
    if (unsafeSegments(rel)) {
      violations.push({ code: 'private-path-in-public', path: rel });
      continue;
    }
    if (!abs.endsWith('.json')) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch {
      violations.push({ code: 'invalid-json', path: rel });
      continue;
    }
    walkStrings(doc, (value, key) => {
      if ((key === 'path' || key.endsWith('_path')) && unsafeSegments(value)) {
        violations.push({ code: 'private-path-in-public', path: `${rel}:${key}` });
      }
      if (grams) {
        for (const gram of eightGrams(tokenize(value))) {
          if (grams.has(gram)) {
            violations.push({ code: 'private-text-leak', path: rel });
            return;
          }
        }
      }
    });
  }
  return { ok: violations.length === 0, violations };
}

// Rendered-output scan (G10.01.b step 6): the static export under out/ must
// carry no extended/private path references and no source maps — the same
// defect classes as the input scan, applied to what the build actually
// shipped (plan §5: the guard covers rendered output, not just data files).
// The path-continuation pattern also accepts the RSC payload's escaped
// slashes (`\/private\/…`); binary assets are skipped by a NUL sniff.
export function scanRenderedOutput({ outDir }: { outDir: string }): ScanResult {
  const violations: Violation[] = [];
  for (const { abs, rel } of listFiles(outDir)) {
    if (abs.endsWith('.map')) {
      violations.push({ code: 'source-map-in-public', path: rel });
      continue;
    }
    const bytes = fs.readFileSync(abs);
    if (bytes.includes(0)) continue;
    const text = bytes.toString('utf8');
    if (/(?:^|[^a-z0-9-])(?:extended|private)\\?\/[a-z0-9._-]/i.test(text)) {
      violations.push({ code: 'private-path-in-public', path: rel });
    } else if (/sourceMappingURL=/.test(text)) {
      violations.push({ code: 'source-map-in-public', path: rel });
    }
  }
  return { ok: violations.length === 0, violations: violations.sort((a, b) => a.path.localeCompare(b.path)) };
}

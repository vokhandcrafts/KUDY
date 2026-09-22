// `node tools/arch-surface/arch-surface.mjs <dir>` — prints the surface of a
// directory: its source files, their exports and their external imports, as
// deterministic plain text. Line-based heuristic extraction (see
// tools/arch-surface/README.md); the correctness bar is the hand verification
// recorded in docs/agent-tasks/results/G18.03.md, not parser completeness.
// Live facts generated next to doc 19, never instead of it.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

// The specifier kinds printed as "imports": `node:*`, bare packages and
// relative paths escaping the scanned directory. Relative paths starting
// with `./` stay inside the directory (their files appear in the listing),
// so they are internal structure, not boundary facts. `../`-escapes are
// external even though they are relative.
function isExternalImport(specifier) {
  if (specifier.startsWith('../')) return true;
  if (specifier.startsWith('./')) return false;
  return true;
}

// One line can carry a specifier even when its `import`/`export` keyword
// sits on an earlier line (multi-line `import type { … } from '…'`), so the
// `from '<spec>'` pattern is matched per line on its own.
function extractExternalImports(line, into) {
  const from = line.match(/\bfrom\s*['"]([^'"]+)['"]/);
  if (from) {
    if (isExternalImport(from[1])) into.add(from[1]);
    return;
  }
  const sideEffect = line.match(/\bimport\s*['"]([^'"]+)['"]/);
  if (sideEffect && isExternalImport(sideEffect[1])) into.add(sideEffect[1]);
  const dynamic = line.match(/\bimport\s*\(\s*['"]([^'"]+)['"]/);
  if (dynamic && isExternalImport(dynamic[1])) into.add(dynamic[1]);
}

// `export { a as b, type c }` — the exported name is the alias after `as`
// when present, the original otherwise; inline `type` markers are stripped.
function braceNames(inside, into) {
  for (const item of inside.split(',')) {
    const name = item.trim().replace(/^type\s+/, '');
    if (name === '') continue;
    const as = name.match(/^(.*?)\s+as\s+(\S+)$/);
    into.add(as ? as[2] : name);
  }
}

function extractExportNames(line, into) {
  let match = line.match(/^export\s+default\b/);
  if (match) {
    into.add('default');
    return;
  }
  // `export * from '…'` / `export * as ns from '…'` — the namespace alias is
  // an exported name; the module itself is an import fact (matched above).
  match = line.match(/^export\s+\*\s*(?:as\s+([\w$]+)\s*)?from\s*['"][^'"]+['"]/);
  if (match) {
    if (match[1]) into.add(match[1]);
    return;
  }
  match = line.match(/^export\s+(?:type\s+)?\{([^}]*)\}/);
  if (match) {
    braceNames(match[1], into);
    return;
  }
  match = line.match(/^export\s+(?:declare\s+)?(?:const|let|var)\s*\{([^}]*)\}/);
  if (match) {
    braceNames(match[1], into);
    return;
  }
  match = line.match(/^export\s+(?:declare\s+)?const\s+enum\s+([\w$]+)/)
    ?? line.match(/^export\s+(?:declare\s+)?(?:type|interface|enum)\s+([\w$]+)/)
    ?? line.match(/^export\s+(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)/)
    ?? line.match(/^export\s+(?:declare\s+)?(?:abstract\s+)?class\s+([\w$]+)/)
    ?? line.match(/^export\s+(?:declare\s+)?(?:const|let|var)\s+([\w$]+)/);
  if (match) into.add(match[1]);
}

function isSourceFile(name) {
  return SOURCE_EXTENSIONS.has(path.extname(name));
}

function walkSources(dir, rel, files) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.error(`arch-surface: cannot list ${rel || '.'}: ${err.message}`);
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const entryRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      walkSources(path.join(dir, entry.name), entryRel, files);
    } else if (entry.isFile() && isSourceFile(entry.name)) {
      files.push(entryRel);
    }
  }
}

function scanFile(absFile) {
  const exports = new Set();
  const imports = new Set();
  let text;
  try {
    text = fs.readFileSync(absFile, 'utf8');
  } catch (err) {
    console.error(`arch-surface: cannot read ${absFile}: ${err.message}`);
    return { exports, imports, unreadable: true };
  }
  for (const line of text.split(/\r?\n/)) {
    extractExternalImports(line, imports);
    extractExportNames(line, exports);
  }
  return { exports, imports };
}

function render(dirLabel, files, surfaces) {
  const out = [`# arch-surface: ${dirLabel}`];
  if (files.length === 0) {
    out.push('no source files found');
    return out.join('\n');
  }
  for (const file of files) {
    const { exports, imports, unreadable } = surfaces[file];
    out.push(`\n## ${file}`);
    out.push(`exports: ${unreadable ? '(unreadable)' : [...exports].sort().join(', ') || '(none)'}`);
    out.push(`imports: ${unreadable ? '(unreadable)' : [...imports].sort().join(', ') || '(none)'}`);
  }
  return out.join('\n');
}

function main(argv) {
  if (argv.length !== 1) {
    console.error('usage: node tools/arch-surface/arch-surface.mjs <dir>');
    return 2;
  }
  const dirArg = argv[0];
  const dirLabel = dirArg.replace(/[\\/]+$/, '');
  let stat;
  try {
    stat = fs.statSync(dirArg);
  } catch {
    console.error(`arch-surface: <dir> does not exist: ${dirArg}`);
    return 2;
  }
  if (!stat.isDirectory()) {
    console.error(`arch-surface: <dir> is not a directory: ${dirArg}`);
    return 2;
  }
  const files = [];
  const absDir = path.resolve(dirArg);
  walkSources(absDir, '', files);
  files.sort();
  const surfaces = {};
  for (const file of files) surfaces[file] = scanFile(path.join(absDir, file));
  console.log(render(dirLabel, files, surfaces));
  return 0;
}

process.exitCode = main(process.argv.slice(2));

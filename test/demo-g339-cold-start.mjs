// Deterministic demo driver for issue #339: the app/ router purity verdict
// (the same classification the guard suite runs) and the index redirect
// wiring. No emulator, no server — the output block in
// docs/demos/2026-09-27-g339-cold-start.md is captured from this.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appDir = join(root, 'app');

function listAppFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? listAppFiles(full) : [full];
  });
}

const isSpecial = (base) => base.startsWith('+') || base.startsWith('_');
const isSuite = (base) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(base);

const rels = listAppFiles(appDir).map((file) => file.slice(appDir.length + 1));
const baseOf = (rel) => rel.split('/').pop();
const isRoute = (rel) => /export\s+default/.test(readFileSync(join(appDir, rel), 'utf8'));

const nonscreen = rels.filter((rel) => !isSpecial(baseOf(rel)) && !isSuite(baseOf(rel)) && !isRoute(rel));
const routes = rels.filter((rel) => !isSpecial(baseOf(rel)) && !isSuite(baseOf(rel)) && isRoute(rel));
const special = rels.filter((rel) => isSpecial(baseOf(rel)));
const suites = rels.filter((rel) => isSuite(baseOf(rel)));
console.log(
  `app/: routes=${routes.length} special=${special.length} suites=${suites.length} nonscreen=${nonscreen.length}` +
    (nonscreen.length ? ` (${nonscreen.join(', ')})` : ''),
);

const index = readFileSync(join(appDir, 'index.tsx'), 'utf8');
console.log(`cold start: index ${/Redirect/.test(index) ? 'Redirect' : 'MISSING'} -> ${/href="\/explore"/.test(index) ? '/explore' : 'MISSING'}`);
console.log('components/: design-tokens, guide-card, guide-card.test, placeholder, walk-button');

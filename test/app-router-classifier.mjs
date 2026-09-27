// Shared app/ router-purity classifier (issue #339): one implementation used
// by the guard suite (test/app-router-purity.test.mjs) and the demo driver
// (test/demo-g339-cold-start.mjs) so the two cannot drift apart. Classes a
// file of app/ as: special (router files `+*`/`_layout`), suite (colocated
// jest `*.test.*` — the metro blockList keeps them out of the bundle), route
// (a default export — what expo-router treats as a screen) or nonscreen
// (everything else — the offender the guard fails on).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const isSpecial = (base) => base.startsWith('+') || base.startsWith('_');
const isSuite = (base) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(base);

export function classifyAppFiles(appDir) {
  function listFiles(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      return entry.isDirectory() ? listFiles(full) : [full];
    });
  }
  const rels = listFiles(appDir).map((file) => file.slice(appDir.length + 1));
  const baseOf = (rel) => rel.split('/').pop();
  const isRoute = (rel) => /export\s+default/.test(readFileSync(join(appDir, rel), 'utf8'));
  return {
    routes: rels.filter((rel) => !isSpecial(baseOf(rel)) && !isSuite(baseOf(rel)) && isRoute(rel)),
    special: rels.filter((rel) => isSpecial(baseOf(rel))),
    suites: rels.filter((rel) => isSuite(baseOf(rel))),
    nonscreen: rels.filter((rel) => !isSpecial(baseOf(rel)) && !isSuite(baseOf(rel)) && !isRoute(rel)),
  };
}

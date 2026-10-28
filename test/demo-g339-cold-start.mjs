// Deterministic demo driver for issue #339: the app/ router purity verdict
// (the same shared classifier the guard suite runs —
// test/app-router-classifier.mjs) and the index route wiring. No
// emulator, no server — the output block in
// docs/demos/2026-09-27-g339-cold-start.md is captured from this.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyAppFiles } from './app-router-classifier.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appDir = join(root, 'app');

const { routes, special, suites, nonscreen } = classifyAppFiles(appDir);
console.log(
  `app/: routes=${routes.length} special=${special.length} suites=${suites.length} nonscreen=${nonscreen.length}` +
    (nonscreen.length ? ` (${nonscreen.join(', ')})` : ''),
);

const index = readFileSync(join(appDir, 'index.tsx'), 'utf8');
const scene = /<AnimatedSplash\s+elapsedMs=/.test(index);
const handoff = /router\.replace\("\/explore"\)/.test(index);
console.log(`cold start: index ${scene ? 'AnimatedSplash' : 'MISSING'} -> ${handoff ? '/explore' : 'MISSING'}`);

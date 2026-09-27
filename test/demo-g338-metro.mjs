// Deterministic demo driver for issue #338: prints the committed Metro
// wiring verdicts (blockList exclusions, node:* → stub resolution) and the
// stub's call-time-only failure. No server, no timings — the output block in
// docs/demos/2026-09-27-g338-metro-device-bundle.md is captured from this.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const config = require(join(root, 'metro.config.js'));
const stubPath = join(root, 'metro-node-stub.js');

const excluded = (candidate) =>
  (Array.isArray(config.resolver.blockList) ? config.resolver.blockList : []).some(
    (entry) => entry instanceof RegExp && entry.test(candidate),
  );
console.log(
  `blockList: jest=${excluded('/repo/app/navigation.test.tsx')} ` +
    `mimosa=${excluded('/repo/.mimosa/hook-state/sess_1.lock')} ` +
    `zcode=${excluded('/repo/.zcode/cli/state.json')} ` +
    `scratch=${excluded('/repo/.scratch/notes.md')} ` +
    `appCode=${excluded('/repo/app/_layout.tsx')}`,
);

const resolved = config.resolver.resolveRequest({}, 'node:path', 'android');
assert.equal(resolved.type, 'sourceFile');
console.log(`node:path -> ${resolved.type} ${resolved.filePath === stubPath ? 'metro-node-stub.js' : resolved.filePath}`);

const stub = require(stubPath);
try {
  stub.isAbsolute('/abs');
  console.log('stub call: NO THROW (defect)');
} catch (error) {
  console.log(`stub call: ${error.message}`);
}

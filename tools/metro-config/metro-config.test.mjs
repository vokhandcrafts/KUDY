// Guard for the device-bundle Metro wiring (issue #338, implementation-rules
// 1 and 7 — config counts as code and the runner glob is wired in the same
// change). Removing either element of the fix — the blockList or the
// node:* → stub resolveRequest — turns a test here red; deleting the stub
// file fails the resolution and existence assertions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const config = require(join(root, 'metro.config.js'));

const inBlockList = (candidate) =>
  (Array.isArray(config.resolver.blockList) ? config.resolver.blockList : [])
    .some((entry) => entry instanceof RegExp && entry.test(candidate));

test('guard: metro blockList keeps test files and agent-session dirs out of the device bundle', () => {
  // Metro module paths are absolute, and the session-dir pattern anchors on
  // the separator before the dot-directory — candidates mirror that.
  assert.ok(
    inBlockList('/repo/app/navigation.test.tsx'),
    'blockList must exclude colocated *.test.* files (expo-router require.context pulls them into the bundle)'
  );
  assert.ok(
    inBlockList('/repo/.mimosa/hook-state/sess_x.lock'),
    'blockList must exclude .mimosa (the fallback watcher dies on vanishing lock files)'
  );
  assert.ok(inBlockList('/repo/.zcode/cli/state.json'), 'blockList must exclude .zcode');
  assert.ok(inBlockList('/repo/.scratch/notes.md'), 'blockList must exclude .scratch');
  assert.equal(
    inBlockList('/repo/app/_layout.tsx'),
    false,
    'blockList must not exclude app code'
  );
});

test('guard: metro resolveRequest maps node:* to the committed throwing stub', () => {
  const resolved = config.resolver.resolveRequest({}, 'node:path', 'android');
  assert.equal(resolved.type, 'sourceFile');
  assert.equal(
    resolved.filePath,
    join(root, 'metro-node-stub.js'),
    'node:* specifiers must resolve to metro-node-stub.js'
  );
  assert.ok(existsSync(resolved.filePath), 'the stub file must exist in the repo');
});

test('guard: the stub loads silently and throws only when a builtin is called', () => {
  const stub = require(join(root, 'metro-node-stub.js'));
  let bound;
  assert.doesNotThrow(() => {
    bound = stub.isAbsolute;
  }, 'importing/reading bindings must not throw (module load happens on device)');
  assert.equal(typeof bound, 'function');
  assert.throws(() => bound(), /KUDY: node builtin isAbsolute/, 'the call must fail loudly');
});

test('guard: the app value-chain sources stay node-free (the #338 criterion-1 revert)', () => {
  // The stub only fails at call time, so a returned `node:*` import in the
  // value chain would build silently and break on device — the sources the
  // #338 proof names are asserted directly instead.
  for (const rel of [
    'controllers/createServices.ts',
    'services/contentRepo/inventory.ts',
    'services/safe-path.ts',
  ]) {
    const source = readFileSync(join(root, rel), 'utf8');
    assert.doesNotMatch(
      source,
      /from\s+['"]node:/,
      `${rel} must not import node:* (the device bundle resolves it to the throwing stub)`,
    );
  }
});

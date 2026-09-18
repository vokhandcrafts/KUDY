// G04.03 — wiring guards (implementation-rules 1 and 7: runner wiring is a
// contract, and every guard here fails when its fixed line reverts).
// 1. the services suite stays enumerated in the default npm test command;
// 2. services keeps its own typecheck pass — excluded from the Expo root
//    config (web precedent: node's explicit .ts specifiers need
//    allowImportingTsExtensions) and typechecked via `tsc -p services`;
// 3. the readiness core stays network-free — G04.03 criterion 3 (offline
//    readiness) is a source property, so the guard pins it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');

test('wiring: the services suite runs in the default npm test command', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.test, /"services\/\*\*\/\*\.test\.ts"/);
});

test('wiring: services is typechecked by its own pass, not swept by the Expo root config', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.typecheck, /tsc --noEmit -p services/, 'the services typecheck pass vanished from npm run typecheck');
  const cfg = JSON.parse(read('tsconfig.json'));
  assert.equal((cfg.exclude ?? []).includes('services'), true, 'root tsc must keep excluding services (TS5097 on .ts specifiers)');
});

test('wiring: the readiness core stays network-free (G04.03 criterion 3)', () => {
  const core = read('services/contentRepo/contentRepo.ts');
  assert.doesNotMatch(core, /\bfetch\s*\(|from ['"](?:node:)?(?:http|https|net)['"]|XMLHttpRequest|WebSocket/);
});

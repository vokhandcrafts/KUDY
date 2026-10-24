// The parsed machine token block of docs/design/visual-language.md — the one
// shared copy for the canon guards (design-tokens pairs, run-map status
// colors, dark-theme spec); a sibling variant would be a jscpd clone
// (implementation-rules 3).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

export function loadMachineBlock(mdPath) {
  const fenced = readFileSync(mdPath, 'utf8').split('```json')[1];
  assert.ok(fenced, mdPath + ' must contain the machine token block (```json)');
  try {
    return JSON.parse(fenced.split('```')[0]);
  } catch (error) {
    assert.fail(`${mdPath} machine token block is not valid JSON: ${error.message}`);
  }
}

export function loadCanon() {
  return loadMachineBlock(join(root, '..', 'docs/design/visual-language.md'));
}

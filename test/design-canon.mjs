// The parsed machine token block of docs/design/visual-language.md — the one
// shared copy for the canon guards (design-tokens pairs, run-map status
// colors); a sibling variant would be a jscpd clone (implementation-rules 3).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const canonPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs/design/visual-language.md');

export function loadCanon() {
  const fenced = readFileSync(canonPath, 'utf8').split('```json')[1];
  assert.ok(fenced, 'visual-language.md must contain the machine token block (```json)');
  try {
    return JSON.parse(fenced.split('```')[0]);
  } catch (error) {
    assert.fail(`canon token block is not valid JSON: ${error.message}`);
  }
}

// G04.02.a — wiring guards (implementation-rules 1 and 7: every fixed line
// fails when reverted). The activation core takes its byte source as an
// injected port (the network belongs to G04.02.b), and the committed fixture
// bytes stay EOL-pinned so the raw-byte hashing guard cannot silently rot
// (implementation-rules 4, AR-1).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8');

test('wiring: the download core stays network-free — the byte source is a port (G04.02.a)', () => {
  const core = read('services/download/download.ts');
  assert.doesNotMatch(
    core,
    /from ['"](?:node:)?(?:http|https|net|undici)['"]|XMLHttpRequest|WebSocket|(?:^|[^\w.])fetch\s*\(/,
    'the activation core must fetch through the injected port, never the network',
  );
});

test('wiring: the download fixtures stay byte-pinned (G04.02.a criterion 6, rule 4)', () => {
  for (const fixture of ['crlf.txt', 'bytes.bin']) {
    const rel = `services/download/fixtures/eol/${fixture}`;
    const out = execFileSync('git', ['check-attr', 'text', '--', rel], { cwd: repo }).toString();
    assert.match(out, new RegExp(`${rel.replace('.', '\\.')}: text: unset`), rel);
  }
});

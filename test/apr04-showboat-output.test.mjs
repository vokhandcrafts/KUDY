// APR-04 (#809): removing the Showboat PASS-time normalization must fail a
// committed check. Live replay additionally uses showboat verify.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('APR-04 Showboat records suite identity, never variable Jest PASS timings', () => {
  const demo = readFileSync(
    join(process.cwd(), 'docs/demos/2026-10-18-apr04-android-accessibility.md'),
    'utf8',
  );
  const command = demo.match(/```bash\n([\s\S]*?)\n```/)?.[1];
  assert.ok(command, 'the executable Showboat command must remain');
  assert.match(
    command,
    /grep "\^PASS " \| awk '\{print \$1, \$2\}' \| LC_ALL=C sort/,
    'strip optional Jest duration suffixes before sorting the recorded PASS lines',
  );
  assert.match(command, /if \[ "\$code" -ne 0 \]/, 'a failing Jest run cannot masquerade as proof');
});

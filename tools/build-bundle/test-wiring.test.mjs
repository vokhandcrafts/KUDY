import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Implementation-rules 1 and 7: every committed suite must stay wired into the
// default test command. If the `tools/build-bundle/*.test.mjs` glob is dropped
// from `npm test`, this file stops running — the residual is that a revert
// which removes the whole glob is only caught by review/CI; see result G02.03.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const committedSuites = [
  ...execFileSync('git', ['ls-files', '*.test.mjs'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter((rel) => rel !== '' && !rel.startsWith('spikes/')),
  // Implementation-rules 7: .ts suites are wired through glob entries too —
  // G08.01 added supabase/**/*.test.ts, so this guard enumerates them as well.
  ...execFileSync('git', ['ls-files', '*.test.ts'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter((rel) => rel !== ''),
];

test('guard: npm test enumerates every committed suite outside spikes', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const script = pkg.scripts?.test ?? '';
  assert.match(script, /node --test/, 'default command must run the node test runner');
  for (const suite of committedSuites) {
    const wired =
      script.includes(suite) ||
      (script.includes('tools/arch/*.test.mjs') && suite.startsWith('tools/arch/')) ||
      (script.includes('tools/arch-surface/*.test.mjs') && suite.startsWith('tools/arch-surface/')) ||
      (script.includes('tools/build-bundle/*.test.mjs') && suite.startsWith('tools/build-bundle/')) ||
      (script.includes('tools/validate/*.test.mjs') && suite.startsWith('tools/validate/')) ||
      (script.includes('tools/publish-catalog/*.test.mjs') && suite.startsWith('tools/publish-catalog/')) ||
      (script.includes('tools/collector/*.test.mjs') && suite.startsWith('tools/collector/')) ||
      (script.includes('docs/run-model/') && suite.startsWith('docs/run-model/')) ||
      (script.includes('services/**/*.test.ts') && suite.startsWith('services/')) ||
      (script.includes('core/**/*.test.ts') && suite.startsWith('core/')) ||
      (script.includes('web/**/*.test.ts') && suite.startsWith('web/')) ||
      (script.includes('supabase/**/*.test.ts') && suite.startsWith('supabase/'));
    assert.ok(wired, `${suite} is not wired into "npm test" (${script})`);
  }
});

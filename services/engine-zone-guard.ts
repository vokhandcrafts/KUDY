// Shared source tripwire for the services' engine boundary (criterion 6 of
// G05.02.b / G05.03.a): every listed source of a service module must be free
// of core/engine imports, static and dynamic. A string-level guard only — the
// zone matrix itself stays machine-checked by `npm run arch:check`
// (implementation-rules 18). Extracted when the second service needed the
// same check (implementation-rules 8: no sibling copies).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export async function assertNoEngineImports(dirUrl: URL, files: string[]): Promise<void> {
  for (const file of files) {
    const source = await readFile(new URL(`./${file}`, dirUrl), 'utf8');
    // Import syntax only, static and dynamic: prose may name the boundary it
    // guards.
    for (const quote of ['"', "'"]) {
      for (const form of ['from ', 'import\\(']) {
        const importPattern = new RegExp(`${form}${quote}[^${quote}]*core/engine`);
        assert.equal(importPattern.test(source), false, `${file} imports core/engine`);
      }
    }
  }
}

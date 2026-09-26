// Shared scratch-tree builder for the guard tests that scan synthetic
// directories (rendered-leak, app-links-scan). One implementation, two
// consumers — the jscpd gate treats a second copy as a clone.
// The walk boundary on the fixture side (implementation-rules 14): a key
// that resolves outside the scratch tree is a fixture bug, not a file to
// write — every resolved path is pinned inside the temp root before the
// write happens.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function writeTree(files: Record<string, string | Buffer>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-web-rendered-'));
  const rootAbs = path.resolve(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.resolve(rootAbs, rel);
    if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) {
      throw new Error(`fixture key escapes the temp tree: ${rel}`);
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

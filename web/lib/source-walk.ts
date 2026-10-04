// Shared source-tree walk for the guard tests (map-config, app-links-scan).
// Walk idiom from contracts/interim-catalog.mjs (implementation-rules 14): symlinks are
// skipped and every read is pinned to the realpath of the walked root, so a
// planted link can never pull a guard over files outside web/.
import fs from 'node:fs';
import path from 'node:path';

export function* sourceFiles(webRoot: string, dir: string): Generator<{ real: string; rel: string }> {
  const baseReal = fs.realpathSync(path.join(webRoot, dir));
  for (const entry of fs.readdirSync(baseReal, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    const real = fs.realpathSync(path.resolve(entry.parentPath, entry.name));
    if (real !== baseReal && !real.startsWith(baseReal + path.sep)) {
      throw new Error(`source walk escaped ${dir}: ${path.relative(webRoot, real)}`);
    }
    yield { real, rel: path.relative(webRoot, real).replaceAll(path.sep, '/') };
  }
}

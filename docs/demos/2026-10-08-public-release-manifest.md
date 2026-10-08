# Публічны release-manifest без прыватных запісаў

*2026-10-08T01:26:15Z by Showboat 0.6.1*
<!-- showboat-id: 0d366427-e15a-4f0a-a1a0-d1047ccdf969 -->

Публічны release-manifest на origin складаецца з запісаў public/. Поўны маніфест з прыватнымі запісамі extended застаецца файлам staging.

```bash
node --input-type=module <<'NODE'
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildBundle } from './tools/build-bundle/build-bundle.mjs';
import { publishCatalog } from './tools/publish-catalog/publish-catalog.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'kudy-g2144b-'));
const staging = path.join(root, 'staging');
const target = path.join(root, 'target');
await buildBundle({ inDir: 'fixtures/content/demo-route', outDir: staging });
await publishCatalog({ staging, target, now: '2026-10-08T00:00:00.000Z' });
const staged = JSON.parse(await readFile(path.join(staging, 'release/release-manifest.json'), 'utf8'));
const publishedRaw = await readFile(path.join(target, 'releases/demo-route-a1/1/release-manifest.json'), 'utf8');
const published = JSON.parse(publishedRaw);
const privateEntries = staged.artifacts.filter((artifact) => artifact.path.startsWith('private/'));
console.log(`staging_private_entries ${privateEntries.length}`);
console.log(`published_entries ${published.artifacts.length}`);
console.log(`published_non_public ${published.artifacts.filter((artifact) => !artifact.path.startsWith('public/')).length}`);
console.log(`published_extended_paths ${published.artifacts.filter((artifact) => artifact.path.includes('/extended/')).length}`);
console.log(`published_has_private_path ${privateEntries.some((artifact) => publishedRaw.includes(artifact.path))}`);
console.log(`published_has_private_sha256 ${privateEntries.some((artifact) => publishedRaw.includes(artifact.sha256))}`);
await rm(root, { recursive: true, force: true });
NODE
```

```output
staging_private_entries 6
published_entries 19
published_non_public 0
published_extended_paths 0
published_has_private_path false
published_has_private_sha256 false
```

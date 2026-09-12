import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await rm(path.join(root, 'runtime'), { recursive: true, force: true });
console.log('removed spike runtime data');

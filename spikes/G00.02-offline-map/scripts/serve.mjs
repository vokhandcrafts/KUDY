import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from '../../../tools/serve-static.mjs';
import { verify } from '../lib/package.mjs';

const root = resolve(fileURLToPath(new URL('../runtime/active/', import.meta.url)));
await verify(root);
const server = createStaticServer(root);
server.listen(4173, '127.0.0.1', () => console.log('offline fixture: http://127.0.0.1:4173'));

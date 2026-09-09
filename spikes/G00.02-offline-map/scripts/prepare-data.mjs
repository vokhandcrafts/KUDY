import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { activate } from '../lib/package.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'source');
const runtime = path.join(root, 'runtime');
const packageBytes = 5541 + (await stat(path.join(source, 'lock.json'))).size;
let replacingReadyPackage = false;
try { await stat(path.join(runtime, 'active/lock.json')); replacingReadyPackage = true; } catch {}
const started = performance.now();
const lock = await activate({ source, runtime });
console.log(JSON.stringify({ status: 'ready', compressedBytes: null, contentBytes: lock.diskBytes, activePackageBytes: packageBytes, activationPeakBytes: packageBytes * (replacingReadyPackage ? 2 : 1), prepareMs: Math.round(performance.now() - started), note: 'regular-file bytes; uncompressed local fixture; no download performed' }, null, 2));

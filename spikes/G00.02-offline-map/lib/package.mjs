import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export const files = ['index.html','app.css','app.js','style.json','sprite.svg','glyphs/0-255.json','map.svg','markers.json'];

async function digest(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

export async function verify(directory) {
  const lock = JSON.parse(await readFile(path.join(directory, 'lock.json'), 'utf8'));
  for (const entry of lock.files) {
    const file = path.join(directory, entry.path);
    const details = await stat(file);
    if (details.size !== entry.bytes || await digest(file) !== entry.sha256) throw new Error(`integrity mismatch: ${entry.path}`);
  }
  if (lock.files.length !== files.length || files.some(file => !lock.files.some(entry => entry.path === file))) throw new Error('lock file is incomplete');
  return lock;
}

async function copy(source, destination, interruptAfter) {
  let copied = 0;
  for (const relative of [...files, 'lock.json']) {
    await mkdir(path.dirname(path.join(destination, relative)), { recursive: true });
    const input = await readFile(path.join(source, relative));
    const output = await open(path.join(destination, relative), 'w');
    try { await output.writeFile(input); } finally { await output.close(); }
    copied += 1;
    if (copied === interruptAfter) throw new Error('simulated interrupted copy');
  }
}

export async function activate({ source, runtime, capacity = Infinity, interruptAfter = Infinity }) {
  const lock = await verify(source);
  if (lock.diskBytes > capacity) throw new Error(`insufficient space: need ${lock.diskBytes - capacity} more bytes`);
  const staging = path.join(runtime, 'staging');
  const active = path.join(runtime, 'active');
  const previous = path.join(runtime, 'previous');
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    await copy(source, staging, interruptAfter);
    await verify(staging);
    await rm(previous, { recursive: true, force: true });
    try { await rename(active, previous); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rename(staging, active);
    return lock;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

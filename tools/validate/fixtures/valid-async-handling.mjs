// Synthetic positive fixture (G20.16): the same two operations as the
// negative fixtures with the failures handled — an awaited write and a catch
// that surfaces the original error. The guard requires the check to accept
// this file, so the negative results come from the violations, not from a
// broken setup.
import { writeFile } from 'node:fs/promises';

export async function saveReport(path, bytes) {
  await writeFile(path, bytes);
}

export function parseCount(raw) {
  try {
    return JSON.parse(raw).count;
  } catch (error) {
    throw new Error(`malformed count payload: ${error.message}`);
  }
}

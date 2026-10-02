// Synthetic negative fixture (G20.16): the write returns a promise nobody
// awaits, so a failed save vanishes. tools/validate/tools-check.test.mjs
// lints this file with --no-ignore and requires the check to reject it
// naming @typescript-eslint/no-floating-promises.
import { writeFile } from 'node:fs/promises';

export function saveReport(path, bytes) {
  writeFile(path, bytes);
}

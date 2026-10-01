// G09.05 — the closed consent vocabulary accessor shared by the analytics
// consent (G09.02) and the crash consent: both are durable `settings` rows
// with the same three states (granted | revoked | absent = never asked) and
// the same corrupt-state answer — a named diagnostic, never a silent
// "closed". The thrown error is built by the owning module (its closed error
// class is part of that module's contract), so the helper takes a factory.
import { getSetting } from './db/db.ts';
import type { SqlDriver } from './db/types.ts';

export type ConsentValue = 'granted' | 'revoked';

export function readConsentState(
  driver: SqlDriver,
  key: string,
  toError: (key: string, stored: string) => Error,
): ConsentValue | null {
  const stored = getSetting(driver, key);
  if (stored === null) return null;
  if (stored === 'granted' || stored === 'revoked') return stored;
  throw toError(key, stored);
}

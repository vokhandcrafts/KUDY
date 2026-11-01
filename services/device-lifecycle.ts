// APR-07.a: one asynchronous ownership boundary per SQLite connection.
// Registration, account deletion and senders must never overlap. The lock
// protects in-flight operations, while the persisted deletion phase protects
// after crashes and process restarts. No network or secrets are stored here.
import type { SqlDriver } from './db/types.ts';

const tails = new WeakMap<SqlDriver, Promise<void>>();
const deleteRequests = new WeakMap<SqlDriver, number>();
// If even the initial durable deletion marker cannot be written, keep
// this process fail-closed until an explicit retry persists that marker.
// SQLite failure cannot be guaranteed durable across process termination.
const unpersistedDelete = new WeakSet<SqlDriver>();

export function blockAfterUnpersistedDelete(driver: SqlDriver): void {
  unpersistedDelete.add(driver);
}

export function deletionBarrierPersisted(driver: SqlDriver): void {
  unpersistedDelete.delete(driver);
}

// A registration initiated while deletion is queued behind an active sender
// must not be registered after the delete has already completed.
export function deviceDeletionRequested(driver: SqlDriver): boolean {
  return unpersistedDelete.has(driver) || (deleteRequests.get(driver) ?? 0) > 0;
}

export function markDeviceDeletionRequested(driver: SqlDriver): () => void {
  deleteRequests.set(driver, (deleteRequests.get(driver) ?? 0) + 1);
  return () => {
    const count = (deleteRequests.get(driver) ?? 1) - 1;
    if (count === 0) deleteRequests.delete(driver);
    else deleteRequests.set(driver, count);
  };
}

export async function withDeviceLifecycle<T>(
  driver: SqlDriver,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = tails.get(driver);
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  tails.set(driver, current);
  if (previous) await previous;
  try {
    return await operation();
  } finally {
    if (tails.get(driver) === current) tails.delete(driver);
    release();
  }
}

// G16.01 — the deploy-time import of the trusted feedback target registry
// export into `feedback_target_registry` (21 §5.2). The export is produced
// by tools/build-bundle (release/feedback-target-registry.json: canonical
// JSON `{schema_version: 1, status: 'prepared', targets: [...]}`, sha-pinned
// in the release manifest) and reaches this code only through the service
// role — no client or arbitrary URL can ever fill the registry.
//
// The two-step publication of 21 §5.2:
//   1. `importFeedbackRegistry` upserts the export's targets as `prepared`
//      (on conflict do nothing — an already published or prepared row is
//      never downgraded or rewritten, so re-importing an old release after a
//      rollback erases nothing);
//   2. `publishFeedbackTargets` moves exactly those targets from `prepared`
//      to `published` once the release itself is verified — a crash between
//      the steps leaves `prepared` rows that answer 503, and re-running
//      both steps reconciles the interrupted publication.
//
// Targets are validated against the FeedbackTarget contract before any
// write (contracts/schemas/feedback-target.schema.json shape: kind/id/
// version/locale + status, additionalProperties false) — a malformed export
// fails closed without importing a partial set. The same structural rules
// live once in feedback-core.validateTarget; the export-specific checks
// (envelope, per-target status) live here.
import {
  validateTarget,
  type FeedbackTargetKey,
} from './feedback-core.ts';

export interface FeedbackRegistryExport {
  schema_version: number;
  status: string;
  targets: ReadonlyArray<Record<string, unknown>>;
}

export type ExportVerdict = { ok: true; keys: FeedbackTargetKey[] } | { ok: false; reason: string };

/**
 * The registry contract's locale enum read from the committed schema file
 * (feedback-target.schema.json pins {be,en,uk}); the core suite guards the
 * constant against the file. The publisher cannot register a target the
 * schema does not describe.
 */
export const REGISTRY_LOCALES: readonly string[] = ['be', 'en', 'uk'];

export function validateRegistryExport(candidate: unknown): ExportVerdict {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return { ok: false, reason: 'registry export: must be a JSON object' };
  }
  const doc = candidate as Record<string, unknown>;
  if (doc['schema_version'] !== 1) {
    return { ok: false, reason: 'registry export: schema_version must be 1' };
  }
  if (doc['status'] !== 'prepared') {
    return { ok: false, reason: 'registry export: status must be prepared' };
  }
  if (!Array.isArray(doc['targets']) || doc['targets'].length === 0) {
    return { ok: false, reason: 'registry export: targets must be a non-empty array' };
  }
  const keys: FeedbackTargetKey[] = [];
  for (let i = 0; i < doc['targets'].length; i += 1) {
    const entry = doc['targets'][i] as Record<string, unknown>;
    // The export target carries its own `status` (build-bundle's prepared
    // shape); strip it before the structural check and verify it separately.
    const { status: targetStatus, ...target } = entry;
    const verdict = validateTarget(target);
    if (!verdict.ok) return { ok: false, reason: `registry export targets[${i}]: ${verdict.reason}` };
    if (targetStatus !== 'prepared') {
      return { ok: false, reason: `registry export targets[${i}].status: must be prepared` };
    }
    if (!REGISTRY_LOCALES.includes(verdict.key.locale)) {
      return { ok: false, reason: `registry export targets[${i}].locale: outside the schema enum` };
    }
    keys.push(verdict.key);
  }
  const unique = new Set(keys.map((key) => `${key.kind}|${key.id}|${key.version}|${key.locale}`));
  if (unique.size !== keys.length) {
    return { ok: false, reason: 'registry export: duplicate target key' };
  }
  return { ok: true, keys };
}

export interface FeedbackRegistryRunner {
  query(sql: string, params?: ReadonlyArray<string | number | boolean | null>): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** Upsert statement: prepared on insert, never touches an existing row. */
export const REGISTRY_IMPORT_SQL =
  'insert into feedback_target_registry (target_kind, target_id, target_version, locale, status) ' +
  "values ($1, $2, $3, $4, 'prepared') " +
  'on conflict (target_kind, target_id, target_version, locale) do nothing returning target_kind';

/** Publication statement: prepared → published for exactly this target, never a bulk flip. */
export const REGISTRY_PUBLISH_SQL =
  'update feedback_target_registry set status = $5, published_at = now() ' +
  'where target_kind = $1 and target_id = $2 and target_version = $3 and locale = $4 and status = $6 ' +
  'returning target_kind';

const keyParams = (key: FeedbackTargetKey): string[] => [key.kind, key.id, key.version, key.locale];

export interface RegistryImportResult {
  imported: number;
  alreadyPresent: number;
}

export async function importFeedbackRegistry(db: FeedbackRegistryRunner, candidate: unknown): Promise<RegistryImportResult> {
  const verdict = validateRegistryExport(candidate);
  if (!verdict.ok) {
    throw new Error(`registry import rejected: ${verdict.reason}`);
  }
  let imported = 0;
  let alreadyPresent = 0;
  for (const key of verdict.keys) {
    const { rows } = await db.query(REGISTRY_IMPORT_SQL, keyParams(key));
    if (rows.length > 0) imported += 1;
    else alreadyPresent += 1;
  }
  return { imported, alreadyPresent };
}

export async function publishFeedbackTargets(db: FeedbackRegistryRunner, candidate: unknown): Promise<number> {
  const verdict = validateRegistryExport(candidate);
  if (!verdict.ok) {
    throw new Error(`registry publish rejected: ${verdict.reason}`);
  }
  let published = 0;
  for (const key of verdict.keys) {
    const { rows } = await db.query(REGISTRY_PUBLISH_SQL, [...keyParams(key), 'published', 'prepared']);
    published += rows.length;
  }
  return published;
}

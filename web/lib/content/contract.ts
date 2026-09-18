// Build-time bridge to contracts/reader.mjs — the single interpretation source
// for the schemas, declared by its header as shared by the validator, the app
// and the web (09 §4). The web must not grow a second schema kernel.
// allowJs is on in web/tsconfig.json because contracts/ stays plain JS.
import * as reader from '../../../contracts/reader.mjs';
import type { ContractError, RejectionCode, ReadResult } from './types.ts';

const contract = reader as {
  validateSchemaFile(schemaFile: string, doc: unknown): { ok: boolean; errors: { keyword?: string; rule?: string; path?: string }[] };
  checkIndexRules(index: unknown): { ok: boolean; errors: { rule: string; path: string }[] };
  readCatalogDoc(doc: unknown): {
    status: 'v1' | 'unknown-major' | 'legacy-v0' | 'invalid';
    routes: unknown[];
    discovery_index: unknown;
    degraded: string | null;
    ok: boolean;
    errors: { rule: string; path: string }[];
  };
};

function toErrors(errors: { keyword?: string; rule?: string; path?: string }[]): ContractError[] {
  return errors.map((e) => ({ rule: e.rule ?? e.keyword ?? 'schema', path: e.path ?? '$' }));
}

export function schemaCheck(schemaFile: string, doc: unknown): ContractError[] {
  const res = contract.validateSchemaFile(schemaFile, doc);
  return res.ok ? [] : toErrors(res.errors);
}

export function indexRulesCheck(doc: unknown): { code: RejectionCode; errors: ContractError[] } | null {
  const res = contract.checkIndexRules(doc);
  return res.ok ? null : { code: 'index-rules-invalid', errors: res.errors.map((e) => ({ rule: e.rule, path: e.path })) };
}

// Web catalog policy: only the v1 envelope renders. The Run reader degrades on
// unknown majors (21 §3.3); the web rejects them — a defined safe rejection per
// the G02.05 rule ("невядомая schema_version бяспечна адхіляецца"), never a
// partial render. legacy-v0 (bare route array) and unknown-major both land here.
export function readCatalogEnvelope(doc: unknown): ReadResult<{
  routes: unknown[];
  discovery_index: unknown;
}> {
  const parsed = contract.readCatalogDoc(doc);
  if (parsed.status !== 'v1') {
    return { ok: false, code: 'unknown-schema-version', errors: [{ rule: 'catalog-schema-version', path: 'catalog_schema_version' }] };
  }
  if (!parsed.ok) {
    return { ok: false, code: 'schema-invalid', errors: parsed.errors.map((e) => ({ rule: e.rule, path: e.path })) };
  }
  return { ok: true, data: { routes: parsed.routes, discovery_index: parsed.discovery_index } };
}

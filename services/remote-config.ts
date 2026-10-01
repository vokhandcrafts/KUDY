// G09.05 — remote config: fetch, contract validation, offline cache and the
// safe default. Sources copied not paraphrased: `09` §5 (GET /v1/config, no
// auth, the closed field list), `05` §12 (the canon of "parameters from the
// server, not constants in code" — radius/dwell/cooldowns change without a
// release; `09` §6.2 carries the config layer row), `19` §2.3 (one provider
// of the numbers, the cache survives offline), issue #295 criteria 3–4.
//
// Boundary: the contract module (contracts/config/remote-config.mjs) is
// node-side — its schema reader opens files — so this module takes the
// checker and the default document as injected dependencies (the
// services/config.ts G07.05 precedent: the wiring passes the same document;
// the type-only shape lives in remote-config.d.mts). Nothing here imports
// node builtins, so the module bundles.
//
// Criterion 3 (never a crash): every data-shaped failure — a failed or
// non-200 fetch, a contract-invalid response, a corrupt or contract-invalid
// cache — answers with named diagnostics and the next fallback
// (network → cache → defaults); nothing here throws for data. The cache row
// is the last accepted network document, replaced only by the next accepted
// one — a rejected response never overwrites it (criterion 4).
import { getSetting, setSetting } from './db/db.ts';
import type { SqlDriver } from './db/types.ts';

// The `09` §5 GET /v1/config document, fields verbatim; the envelope field
// follows the catalog_schema_version precedent (contracts README).
export interface RemoteConfigDocument {
  config_schema_version: 1;
  trigger_radius_default: number;
  dwell_ms: number;
  accuracy_gate_m: number;
  moment_cooldown_min: number;
  moments_per_session_max: number;
  min_app_version: number;
}

export interface RemoteConfigDiagnostic {
  rule: string;
  path?: string;
  detail?: string;
}

export type RemoteConfigCheck = (doc: unknown) => { ok: boolean; errors: RemoteConfigDiagnostic[] };

// The HTTP port — injectable so the refresh is proven without a network
// (device.ts idiom); the default uses fetch.
export interface ConfigHttpTransport {
  getConfig(url: string): Promise<{ status: number; body: unknown }>;
}

function defaultConfigHttpTransport(): ConfigHttpTransport {
  return {
    async getConfig(url) {
      const response = await fetch(url);
      const text = await response.text();
      let parsed: unknown = null;
      if (text !== '') {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
      }
      return { status: response.status, body: parsed };
    },
  };
}

export interface RemoteConfigDeps {
  /** Functions base URL, e.g. https://<ref>.supabase.co/functions/v1 */
  baseUrl: string;
  driver: SqlDriver;
  /** The canonical contract checker (contracts/config/remote-config.mjs). */
  check: RemoteConfigCheck;
  /** The canonical default document (the contract's defaults file). */
  defaults: RemoteConfigDocument;
  transport?: ConfigHttpTransport;
}

export type RemoteConfigSource = 'network' | 'cache' | 'defaults';

export interface RemoteConfigResult {
  config: RemoteConfigDocument;
  source: RemoteConfigSource;
  diagnostics: RemoteConfigDiagnostic[];
}

// The durable cache row (`settings`, zone B — ADR G01.03 §3.3; the same
// key-value home the analytics consent uses). One row, the whole document
// as JSON.
const CACHE_KEY = 'remote_config_cache';

// Offline read (criterion 4): cache → defaults. A cached value that is not
// valid JSON, or that fails the contract, is not trusted and not repaired
// here: named diagnostics, then the default document.
export function readRemoteConfig(
  deps: Pick<RemoteConfigDeps, 'driver' | 'check' | 'defaults'>,
): RemoteConfigResult {
  const stored = getSetting(deps.driver, CACHE_KEY);
  if (stored === null) {
    return { config: deps.defaults, source: 'defaults', diagnostics: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return {
      config: deps.defaults,
      source: 'defaults',
      diagnostics: [{ rule: 'config-cache-corrupt', detail: 'the cached document is not valid JSON' }],
    };
  }
  const verdict = deps.check(parsed);
  if (!verdict.ok) {
    return {
      config: deps.defaults,
      source: 'defaults',
      diagnostics: [
        ...verdict.errors,
        { rule: 'config-cache-invalid', detail: 'the cached document failed its contract' },
      ],
    };
  }
  return { config: parsed as RemoteConfigDocument, source: 'cache', diagnostics: [] };
}

// The one refresh entry point: the network document is applied — and cached
// — only when the contract checker accepts it; everything else falls through
// to the offline read with the collected diagnostics prefixed (criterion 3:
// an invalid response is a diagnostic plus the last accepted or default
// document, never a crash and never a cache overwrite).
export async function refreshRemoteConfig(deps: RemoteConfigDeps): Promise<RemoteConfigResult> {
  const http = deps.transport ?? defaultConfigHttpTransport();
  const diagnostics: RemoteConfigDiagnostic[] = [];
  let accepted: RemoteConfigDocument | null = null;
  try {
    const response = await http.getConfig(`${deps.baseUrl}/config`);
    if (response.status === 200) {
      const verdict = deps.check(response.body);
      if (verdict.ok) {
        accepted = response.body as RemoteConfigDocument;
      } else {
        diagnostics.push(...verdict.errors);
      }
    } else {
      diagnostics.push({ rule: 'config-fetch-failed', detail: `status ${response.status}` });
    }
  } catch (error) {
    diagnostics.push({
      rule: 'config-fetch-failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  if (accepted !== null) {
    setSetting(deps.driver, CACHE_KEY, JSON.stringify(accepted));
    return { config: accepted, source: 'network', diagnostics: [] };
  }
  const offline = readRemoteConfig(deps);
  return { ...offline, diagnostics: [...diagnostics, ...offline.diagnostics] };
}

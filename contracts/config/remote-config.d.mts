// Type surface of the remote config contract for the TS side (services and
// tests import the shapes; the implementation and its rules live in
// remote-config.mjs — this file declares, it does not restate). The field
// names are the `09` §5 GET /v1/config row verbatim.
export interface RemoteConfigDiagnostic {
  rule: string;
  path: string;
}

export function checkRemoteConfig(doc: unknown): { ok: boolean; errors: RemoteConfigDiagnostic[] };

export function loadDefaultRemoteConfig(path?: string): {
  config_schema_version: 1;
  trigger_radius_default: number;
  dwell_ms: number;
  accuracy_gate_m: number;
  moment_cooldown_min: number;
  moments_per_session_max: number;
  min_app_version: number;
};

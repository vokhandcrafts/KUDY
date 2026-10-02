// G05.02.c AC1 — the pure OS-permission mapping: an expo permission response
// lands here structurally and answers the port's PermissionState spelling —
// the only one the service knows (19 §3.3: a missing permission is a status
// value, never a throw). The `status` field is authoritative; expo derives
// its `granted` boolean from the same fact, so it is not read. A future OS
// spelling (iOS «limited») has no port value yet and would be added here —
// the single place OS permission answers meet the port contract.
//
// G20.07 (runtime.md R4) — the foreground and the background questions are
// separate capabilities, and one scope's answer is never passed off as the
// other's. mapScopeAnswer projects one OS answer onto both scopes the port
// tracks; the port reports the foreground capability (every armed mode needs
// it) and routes its update mechanism by the background one. A background
// GRANT implies the foreground one on both platforms (iOS «always» subsumes
// «when in use»; Android grants background only after the foreground one).
// A background DENY settles nothing about the foreground — merging it into
// the foreground state is the defect G20.07 fixes, and the scope tests fail
// on that merge (criterion 4).
import type { LocationPermissionScope, PermissionState } from '../types.ts';

export interface OsPermissionResponse {
  status: 'granted' | 'denied' | 'undetermined';
}

// Both scope states the port tracks after one OS answer is applied.
export interface ScopedPermission {
  foreground: PermissionState;
  background: PermissionState;
}

export function mapScopeAnswer(
  scope: LocationPermissionScope,
  response: OsPermissionResponse,
  previous: ScopedPermission,
): ScopedPermission {
  const status = mapOsStatus(response.status);
  if (scope === 'foreground') {
    return { foreground: status, background: previous.background };
  }
  return {
    foreground: status === 'granted' ? 'granted' : previous.foreground,
    background: status,
  };
}

// The OS boundary is not trusted at any depth: an unknown status spelling (a
// future OS value, a corrupt response) lands on the safe 'undetermined' side
// — the port keeps waiting instead of acting on a misread answer
// (implementation-rules 14).
function mapOsStatus(status: unknown): PermissionState {
  return status === 'granted' || status === 'denied' || status === 'undetermined' ? status : 'undetermined';
}

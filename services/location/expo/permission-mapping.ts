// G05.02.c AC1 — the pure OS-permission mapping: an expo permission response
// lands here structurally and answers the port's PermissionState spelling —
// the only one the service knows (19 §3.3: a missing permission is a status
// value, never a throw). The `status` field is authoritative; expo derives
// its `granted` boolean from the same fact, so it is not read. A future OS
// spelling (iOS «limited») has no port value yet and would be added here —
// the single place OS permission answers meet the port contract.
import type { PermissionState } from '../types.ts';

export interface OsPermissionResponse {
  status: 'granted' | 'denied' | 'undetermined';
}

export function mapOsPermission(response: OsPermissionResponse): PermissionState {
  return response.status;
}

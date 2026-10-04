// G08.01 + G09.03 — the device edge function wiring: POST /v1/device
// (registration) and DELETE /v1/device (device data deletion — the devices
// row goes and the FK cascades take event_log / entitlement_cache /
// event_send_rate with it). The contract logic — rate-limit decision,
// registration, deletion, the redacted internal-failure diagnostics — lives
// in ../_shared/device-wire.ts + ../_shared/device-core.ts (proven by node
// --test and the PGlite RLS suite); this file is the Supabase-runtime wiring
// only, exercised on the Supabase runtime at deploy time and marked not-run
// in docs/agent-tasks/results/G08.01.md and G09.03.md (no Supabase project
// is attached to this repo yet).
//
// Path mapping: the canonical `POST /v1/device` and `DELETE /v1/device` are
// served by this function at
// `https://<project-ref>.supabase.co/functions/v1/device`.
//
// Environment (fail-closed, the G00.03 spike's env-gate idiom):
//   DATABASE_URL — Postgres connection string with the service role.
// Non-device requests and missing env never reach the database.
import { deviceErrorResponse, handleDeviceRequest } from '../_shared/device-wire.ts';
import { logServerDiagnostic } from '../_shared/server-diagnostics.ts';
import { database } from '../_shared/postgres-connection.ts';

Deno.serve(async (req) => {
  try {
    return await handleDeviceRequest(req, database());
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('DATABASE_URL')) {
      logServerDiagnostic('device_registration', 'configuration_missing');
      return deviceErrorResponse(500, 'server_configuration_error');
    }
    logServerDiagnostic('device_registration', 'unexpected_failure');
    return deviceErrorResponse(500, 'server_error');
  }
});

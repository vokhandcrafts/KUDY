// G08.01 — POST /v1/device (docs/architecture/09 §5): the Deno wiring for the
// device-registration edge function. The contract logic — rate-limit decision,
// registration, the redacted internal-failure diagnostics — lives in
// ../_shared/device-wire.ts + ../_shared/device-core.ts (proven by node --test
// and the PGlite RLS suite); this file is the Supabase-runtime wiring only.
//
// Path mapping: the canonical `POST /v1/device` is served by this function at
// `https://<project-ref>.supabase.co/functions/v1/device`.
//
// Environment (fail-closed, the G00.03 spike's env-gate idiom):
//   DATABASE_URL — Postgres connection string with the service role.
// Non-POST requests and missing env never reach the database.
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

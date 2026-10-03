// G16.01 — the feedback edge function: POST /v1/feedback/read, PUT
// /v1/feedback and POST /v1/feedback/delete (21 §5.3). The contract logic —
// validation, idempotency, CAS, the closed answer list — lives in
// ./feedback-core.ts + ./registry-import.ts (proven by node --test and the
// PGlite suites in supabase/tests/feedback/); this file is the
// Supabase-runtime wiring only, exercised on the Supabase runtime at deploy
// time and marked not-run in docs/agent-tasks/results/G16.01.md (no
// Supabase project is attached to this repo yet).
//
// Environment (fail-closed, the device function's env-gate idiom):
//   DATABASE_URL — Postgres connection string with the service role.
// Non-feedback paths and missing env never reach the database.
import { feedbackErrorResponse, handleFeedbackEdgeRequest } from './feedback-wire.ts';
import { logServerDiagnostic } from '../_shared/server-diagnostics.ts';
import { database } from '../_shared/postgres-connection.ts';

Deno.serve(async (req) => {
  try {
    return await handleFeedbackEdgeRequest(req, database());
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('DATABASE_URL')) {
      logServerDiagnostic('feedback', 'configuration_missing');
      return feedbackErrorResponse(503, 'feedback_unavailable');
    }
    logServerDiagnostic('feedback', 'unexpected_failure');
    return feedbackErrorResponse(503, 'feedback_unavailable');
  }
});

// G16.01 — the feedback edge function wiring: POST /v1/feedback/read,
// PUT /v1/feedback and POST /v1/feedback/delete (21 §5.3), served by the
// `feedback` function. The contract logic — validation, idempotency, CAS,
// the closed answer list — lives in ./feedback-core.ts (proven by node --test
// and the PGlite suites in supabase/tests/feedback/); this file is the
// Supabase-runtime wiring only: path/method resolution, the bounded body
// read, the postgres.js adaptation and the port-fault answer.
//
// Fault mapping (21 §5.3: 503 «часовая немагчымасць праверыць або
// захаваць»): a storage fault — including a missing DATABASE_URL — answers
// 503 feedback_unavailable with exactly one redacted server diagnostic.
// This is the feedback contract's own code for a temporary inability to
// save; the events intake's 500 mapping is a different endpoint contract.
//
// Path mapping: the canonical /v1/feedback[-read|-delete] suffixes are
// served at `https://<project-ref>.supabase.co/functions/v1/feedback…`;
// the suffix match is independent of the runtime mount prefix.
//
// Environment (fail-closed, the device function's env-gate idiom):
//   DATABASE_URL — Postgres connection string with the service role.
import { logServerDiagnostic } from '../_shared/server-diagnostics.ts';
import { deviceClientIp } from '../_shared/device-wire.ts';
import { hashIp } from '../_shared/device-core.ts';
import {
  defaultFeedbackConfig,
  handleFeedbackRequest,
  createSqlFeedbackPort,
  type FeedbackConfig,
  type FeedbackRequestLike,
  type FeedbackSqlRunner,
  type FeedbackSqlStatements,
} from './feedback-core.ts';

export interface RequestLike {
  method: string;
  url: string;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * The postgres.js surface the wiring uses: `unsafe()` for the pinned
 * statements and `begin()` for the CAS transaction. The real `postgres.Sql`
 * satisfies this shape structurally; `begin` hands its callback a
 * TransactionSql that keeps `unsafe` but cannot nest another transaction —
 * the statement surface below mirrors exactly that.
 */
export interface FeedbackSqlStatementsClient {
  unsafe(sql: string, params: (string | number | boolean | null)[]): PromiseLike<ArrayLike<unknown>>;
}

export interface FeedbackSqlClient extends FeedbackSqlStatementsClient {
  begin<T>(work: (tx: FeedbackSqlStatementsClient) => Promise<T>): Promise<T>;
}

export function feedbackErrorResponse(status: number, error: string, extraHeaders: Record<string, string> = {}): Response {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify({ error }), { status, headers });
}

// The delete core reads the PGlite-style `{ rows }` surface; the production
// driver is the pinned postgres.js client, so the wiring adapts the one call
// shape to the other — the transaction hands its work a statement-only view
// on the same connection (the device-wire adapter idiom).
function feedbackStatementRunner(db: FeedbackSqlStatementsClient): FeedbackSqlStatements {
  return {
    async query(sql: string, params: ReadonlyArray<string | number | boolean | null>) {
      const rows = await db.unsafe(sql, [...params]);
      return { rows: Array.from(rows) as Array<Record<string, unknown>> };
    },
  };
}

function feedbackSqlRunner(db: FeedbackSqlClient): FeedbackSqlRunner {
  return {
    ...feedbackStatementRunner(db),
    transaction<T>(work: (runner: FeedbackSqlStatements) => Promise<T>): Promise<T> {
      return db.begin((tx) => work(feedbackStatementRunner(tx)));
    },
  };
}

export function feedbackOperation(req: RequestLike): 'read' | 'put' | 'delete' | null {
  const { pathname } = new URL(req.url);
  if (req.method === 'PUT' && pathname.endsWith('/v1/feedback')) return 'put';
  if (req.method === 'POST' && pathname.endsWith('/v1/feedback/read')) return 'read';
  if (req.method === 'POST' && pathname.endsWith('/v1/feedback/delete')) return 'delete';
  return null;
}

export async function handleFeedbackEdgeRequest(req: RequestLike, db: FeedbackSqlClient, config?: FeedbackConfig): Promise<Response> {
  const operation = feedbackOperation(req);
  if (operation === null) {
    return feedbackErrorResponse(404, 'not_found');
  }
  const rawBody = new Uint8Array(await req.arrayBuffer());
  const request: FeedbackRequestLike = {
    method: req.method,
    operation,
    authorization: req.headers.get('authorization'),
    // The raw address never persists — the fixed-window key is its hash
    // (the device registration idiom).
    ipHash: hashIp(deviceClientIp(req)),
    rawBody,
  };
  let answer;
  try {
    answer = await handleFeedbackRequest(request, createSqlFeedbackPort(feedbackSqlRunner(db)), config ?? defaultFeedbackConfig(Date.now()));
  } catch {
    logServerDiagnostic('feedback', 'feedback_request_failed');
    return feedbackErrorResponse(503, 'feedback_unavailable');
  }
  if (answer.status === 429) {
    return feedbackErrorResponse(answer.status, answer.error, { 'retry-after': String(answer.retryAfterSeconds) });
  }
  if ('error' in answer) {
    return feedbackErrorResponse(answer.status, answer.error);
  }
  return new Response(JSON.stringify(answer.body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

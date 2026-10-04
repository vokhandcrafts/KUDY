// G16.04 — shared drivers for the report and retention suites: every rating
// goes through the production edge-wire path over PGlite (the
// feedback-pglite idiom), and the report read applies the committed
// feedback-report.sql verbatim — the suites exercise the real contract,
// never a mirrored step list.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleFeedbackEdgeRequest } from '../../supabase/functions/feedback/feedback-wire.ts';
import {
  feedbackRequest,
  freshFeedbackDatabase,
  pgliteFeedbackClient,
  testFeedbackConfig,
} from '../../supabase/tests/feedback/test-support.ts';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const EDGE_URL = 'https://feedback.functions/v1/feedback';
const DISCLOSURE = 'feedback-disclosure-1';

export type FeedbackDb = Awaited<ReturnType<typeof freshFeedbackDatabase>>;
export type GuideTarget = { kind: 'guide'; route_id: string; version: string; locale: string };
export type PlaceTarget = { kind: 'place'; place_id: string; content_version: string; locale: string };
export type RatingTarget = GuideTarget | PlaceTarget;
type AggregateRows = Record<string, unknown>[];

export const feedbackReportSql = (): string => fs.readFileSync(path.join(repoRoot, 'supabase', 'queries', 'feedback-report.sql'), 'utf8');
export const feedbackRetentionSql = (): string => fs.readFileSync(path.join(repoRoot, 'supabase', 'queries', 'feedback-retention.sql'), 'utf8');

let mutationCounter = 0;
function nextMutationId(): string {
  mutationCounter += 1;
  return `00000000-0000-4000-8000-${String(mutationCounter).padStart(12, '0')}`;
}

export const guide = (routeId: string, version: string, locale: string): GuideTarget => ({ kind: 'guide', route_id: routeId, version, locale });
export const place = (placeId: string, contentVersion: string, locale: string): PlaceTarget => ({ kind: 'place', place_id: placeId, content_version: contentVersion, locale });

export async function putRating(
  db: FeedbackDb,
  secret: string,
  target: RatingTarget,
  score: number,
  reasonCodes: string[] = [],
  expectedRevision = 0,
) {
  const request = feedbackRequest({
    method: 'PUT',
    url: EDGE_URL,
    body: {
      mutation_id: nextMutationId(),
      target,
      expected_revision: expectedRevision,
      score,
      reason_codes: reasonCodes,
      disclosure_version: DISCLOSURE,
    },
    secret,
  });
  const response = await handleFeedbackEdgeRequest(request, pgliteFeedbackClient(db), testFeedbackConfig());
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
}

export async function deleteRating(db: FeedbackDb, secret: string, target: RatingTarget, expectedRevision: number) {
  const request = feedbackRequest({
    method: 'POST',
    url: `${EDGE_URL}/delete`,
    body: { mutation_id: nextMutationId(), target, expected_revision: expectedRevision },
    secret,
  });
  const response = await handleFeedbackEdgeRequest(request, pgliteFeedbackClient(db), testFeedbackConfig());
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** The production report read: the committed query over the committed schema. */
export async function readReport(db: FeedbackDb): Promise<AggregateRows> {
  const result = await db.query(feedbackReportSql());
  return result.rows as AggregateRows;
}

export function findRow(rows: AggregateRows, target: RatingTarget): Record<string, unknown> {
  const row = rows.find(
    (candidate) =>
      candidate.target_kind === target.kind &&
      candidate.target_id === (target.kind === 'guide' ? target.route_id : target.place_id) &&
      candidate.target_version === (target.kind === 'guide' ? target.version : target.content_version) &&
      candidate.locale === target.locale,
  );
  assert.ok(row, `expected an aggregate row for ${JSON.stringify(target)}`);
  return row;
}

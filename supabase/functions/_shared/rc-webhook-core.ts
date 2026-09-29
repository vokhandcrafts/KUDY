// G08.06 — the optional POST /v1/rc-webhook core (docs/architecture/09 §5
// «Рэфанды, экспірацыі, TRANSFER → бухгалтэрыя і аналітыка», §5.1 webhook
// rules). The webhook is accounting, not the grant gate: /v1/grant verifies
// the entitlement by asking RevenueCat directly, so this endpoint can be
// disabled, misconfigured or lost without touching grant or restore.
//
// Platform-neutral by contract (the G08.01/G08.02 core idiom): no Deno or
// Node HTTP APIs here — the raw body, the signature header, the clock and
// the SQL storage enter as arguments and ports below. The SQL statements
// are pinned constants proven against real Postgres (PGlite) by
// rc-webhook-core.test.ts; the Deno wiring is
// supabase/functions/rc-webhook/index.ts (not-run until deploy, G08.01
// precedent).

import { createHmac, timingSafeEqual } from 'node:crypto';

// The 64 KiB body bound mirrors GRANT_MAX_BODY_BYTES: the gate runs before
// the HMAC so an oversized request costs nothing and persists nothing.
export const WEBHOOK_MAX_BODY_BYTES = 64 * 1024;
// 09 §5.1: «адкідаць |now − t| > 5 хв» — the signature timestamp window
// (RevenueCat re-signs every delivery attempt, so retries stay inside it).
export const WEBHOOK_SIGNATURE_MAX_AGE_SECONDS = 300;
// Defensive shape bounds for the two fields the contract keys on
// (lessons-learned §3 — input validated where it enters): the event id the
// idempotency keys on, and the type the effects select on.
export const WEBHOOK_ID_MAX_LENGTH = 128;
export const WEBHOOK_TYPE_MAX_LENGTH = 64;

// RevenueCat signs `X-RevenueCat-Webhook-Signature: t=<unix>,v1=<hex>` with
// HMAC-SHA256 over "<t>.<raw body>" — verified on the raw bytes exactly as
// received, BEFORE the JSON parse (re-serialization breaks the signature),
// with a constant-time compare (09 §5.1; the RevenueCat webhooks doc).
export function verifyWebhookSignature(
  signatureHeader: string | null,
  rawBody: Uint8Array,
  secret: string,
  nowMs: number,
): boolean {
  if (signatureHeader === null || secret === '') return false;
  const match = signatureHeader.trim().toLowerCase().match(/^t=(\d{1,15}),v1=([0-9a-f]{64})$/);
  if (match === null) return false;
  const signedAtSeconds = Number(match[1]);
  if (!Number.isSafeInteger(signedAtSeconds)) return false;
  if (Math.abs(nowMs / 1000 - signedAtSeconds) > WEBHOOK_SIGNATURE_MAX_AGE_SECONDS) return false;
  const expected = createHmac('sha256', secret).update(`${signedAtSeconds}.`).update(rawBody).digest();
  const provided = Buffer.from(match[2], 'hex');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

// Corrupt input answers with a rejection, never a thrown error
// (implementation-rules 14): non-UTF-8 bytes, broken JSON, a missing or
// non-object `event`, or an id/type outside the shape bounds are all `null`
// → 400 at the handler, nothing persisted, no rights change.
export function parseWebhookEvent(rawBody: Uint8Array): Record<string, unknown> | null {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(rawBody);
  } catch {
    return null;
  }
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof document !== 'object' || document === null || Array.isArray(document)) return null;
  const event = (document as Record<string, unknown>)['event'];
  if (typeof event !== 'object' || event === null || Array.isArray(event)) return null;
  const record = event as Record<string, unknown>;
  const id = record['id'];
  const type = record['type'];
  if (typeof id !== 'string' || id === '' || id.length > WEBHOOK_ID_MAX_LENGTH) return null;
  if (typeof type !== 'string' || type === '' || type.length > WEBHOOK_TYPE_MAX_LENGTH) return null;
  return record;
}

// The answer of the webhook handler. There is no client on this wire —
// RevenueCat cares only about the status (2xx stops the at-least-once
// retries; anything else re-delivers on its own 5/10/20/40/80-minute
// schedule) — so no error codes are invented beyond the 401 the contract
// names (09 §5.1 acceptance matrix: «сапсаваны подпіс → 401»).
export type WebhookAnswer = { status: 200 } | { status: 400 } | { status: 401 };

// A fault of the store port must never degrade to a lie: the core lets it
// propagate, the wrapper answers 503 and RevenueCat retries the delivery —
// 200 only after the durable persist (09 §5.1).
export interface WebhookSqlRunner {
  /** `true` = first delivery (row inserted); `false` = duplicate event id. */
  persistEvent(input: { eventId: string; type: string; eventTimestampMs: number | null; payload: unknown }): Promise<boolean>;
  readEffectsApplied(eventId: string): Promise<boolean | null>;
  markEffectsApplied(eventId: string): Promise<void>;
  invalidateEntitlementCache(deviceId: string): Promise<void>;
}

export interface WebhookPortDeps {
  store: WebhookSqlRunner;
}

// The SQL of the durable bookkeeping. The idempotency key is the event id
// (RevenueCat reuses it on retries; delivery is at-least-once), and
// `effects_applied` marks the crash window between persist and effects: a
// duplicate that finds it false re-applies the (idempotent) effects before
// answering 200 — «да адказу 200 надзейна захаваць падзею або скончыць яе
// ідэмпатэнтную апрацоўку» (09 §5.1).
export const WEBHOOK_EVENT_INSERT_SQL
  = 'insert into webhook_events (event_id, type, event_at, payload, effects_applied) '
  + 'values ($1, $2, to_timestamp($3 / 1000.0), $4::jsonb, false) '
  + 'on conflict (event_id) do nothing returning event_id';

export const WEBHOOK_EVENT_EFFECTS_READ_SQL
  = 'select effects_applied from webhook_events where event_id = $1';

export const WEBHOOK_EVENT_MARK_APPLIED_SQL
  = 'update webhook_events set effects_applied = true where event_id = $1';

// The rights effect of an accounting event: drop the device's positive
// entitlement_cache rows so the next /grant re-verifies with RevenueCat (the
// gate) instead of trusting a cache row written before the refund. The id
// must be a uuid of OUR devices table — app_user_id strings are
// RevenueCat-side values (aliases included) and never enter SQL raw.
export const WEBHOOK_CACHE_INVALIDATE_SQL
  = 'delete from entitlement_cache where device_id = $1::uuid';

// device_id values are uuid (gen_random_uuid) and RevenueCat maps
// app_user_id = device_id (09 §5.1); an alias-shaped id can never be one of
// our devices, so it is filtered here instead of probing the database.
const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The event types that can only REMOVE a right (source: RevenueCat «Event
// types and fields», verified 2026-09-29): a refund surfaces as CANCELLATION
// (its cancel_reason values have no `refund`; CUSTOMER_SUPPORT covers
// store-processed refunds) and REFUND_REVERSED is the App Store reversal.
// Dropping the cache on reversal is fail-closed: the next /grant re-verifies
// and re-caches if RevenueCat still grants the right.
const CACHE_INVALIDATING_EVENT_TYPES = new Set(['EXPIRATION', 'CANCELLATION', 'REFUND_REVERSED']);

function collectDeviceIds(ids: string[], candidate: unknown): void {
  if (!Array.isArray(candidate)) return;
  for (const item of candidate) {
    if (typeof item === 'string' && DEVICE_ID_PATTERN.test(item) && !ids.includes(item)) ids.push(item);
  }
}

// The devices whose cached rights the event touches — empty for bookkeeping
// events (TEST, INITIAL_PURCHASE, RENEWAL, BILLING_ISSUE, …). TRANSFER moves
// the right OUT of transferred_from (RevenueCat itself re-homes it to
// transferred_to, which needs no action: its next /grant verifies fresh).
// Corrupt field shapes (null elements, wrong types, non-uuid strings)
// contribute nothing and never throw (implementation-rules 14).
export function affectedDeviceIds(event: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const type = event['type'];
  if (type === 'TRANSFER') {
    collectDeviceIds(ids, event['transferred_from']);
  } else if (CACHE_INVALIDATING_EVENT_TYPES.has(type)) {
    if (typeof event['app_user_id'] === 'string' && DEVICE_ID_PATTERN.test(event['app_user_id'])) {
      ids.push(event['app_user_id']);
    }
    collectDeviceIds(ids, event['aliases']);
  }
  return ids;
}

function eventTimestampMs(event: Record<string, unknown>): number | null {
  const value = event['event_timestamp_ms'];
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

async function applyRightsEffects(event: Record<string, unknown>, deps: WebhookPortDeps): Promise<void> {
  for (const deviceId of affectedDeviceIds(event)) {
    await deps.store.invalidateEntitlementCache(deviceId);
  }
}

/**
 * One POST /v1/rc-webhook round. Gate order: size → signature (on the raw
 * bytes, before parsing) → shape → durable persist → effects → mark → 200.
 * A duplicate delivery re-applies the effects only when the first delivery
 * crashed between persist and effects (at-least-once semantics, 09 §5.1).
 */
export async function handleWebhook(
  input: { signatureHeader: string | null; rawBody: Uint8Array; secret: string; nowMs: number },
  deps: WebhookPortDeps,
): Promise<WebhookAnswer> {
  if (input.rawBody.byteLength > WEBHOOK_MAX_BODY_BYTES) return { status: 400 };
  if (!verifyWebhookSignature(input.signatureHeader, input.rawBody, input.secret, input.nowMs)) {
    return { status: 401 };
  }
  const event = parseWebhookEvent(input.rawBody);
  if (event === null) return { status: 400 };

  const eventId = event['id'];
  const eventType = event['type'];
  const inserted = await deps.store.persistEvent({
    eventId,
    type: eventType,
    eventTimestampMs: eventTimestampMs(event),
    payload: event,
  });
  if (inserted) {
    await applyRightsEffects(event, deps);
    await deps.store.markEffectsApplied(eventId);
    return { status: 200 };
  }
  const applied = await deps.store.readEffectsApplied(eventId);
  if (applied !== true) {
    await applyRightsEffects(event, deps);
    await deps.store.markEffectsApplied(eventId);
  }
  return { status: 200 };
}

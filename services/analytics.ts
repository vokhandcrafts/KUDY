// G09.02 — analytics consent and the consent-gated send pipeline. Sources
// copied not paraphrased: `09` §10 (consent is asked before the first send —
// not at first launch; refusal = the log lives only locally, the app works
// fully; the consent state is durable in `settings`), the event table's
// recording policy (local_recording always, sending consent_gated) and the
// issue #286 criteria. Ownership: this module owns the consent state
// semantics over the durable `settings` row and the gated flush — the one
// send entry point that decides consent before the queue is touched; the
// queue semantics stay in services/eventLog (the injected EventSender), the
// SQL stays in services/db (ADR G01.03 §3.3), and the wire endpoint belongs
// to POST /v1/events (supabase/functions/events).
//
// Boundary note: the outgoing batch keeps eventLog's OutgoingEvent shape
// (event_id, type, at, schema_version, payload — verbatim event-table field
// names, implementation-rules 2); the one conversion this transport performs
// is `at` epoch ms → the ISO-8601 UTC string the event table defines (the
// conversion eventLog explicitly deferred here).
import { setSetting } from './db/db.ts';
import type { SqlDriver } from './db/types.ts';
import type { DeviceIdentity } from './device.ts';
import { flushEvents, type EventSender, type OutgoingEvent } from './eventLog.ts';
import { readConsentState } from './consent.ts';
import { assertNotRedirected, parseSecureEndpointUrl, SecureUrlError } from './secure-url.ts';

// Closed consent vocabulary (`09` §10: asked → granted or refused; a granted
// consent can be withdrawn). Absent (never asked) is the third state — the
// gate is closed for it too. Refusal and withdrawal are the same stored
// value: both stop sending and both keep the durable queue untouched.
export type AnalyticsConsent = 'granted' | 'revoked';

// The durable `settings` key (`09` §10: «Стан згоды — у settings»; the key
// name is the one services/db tests already exercise).
const CONSENT_KEY = 'analytics_consent';

export class AnalyticsError extends Error {
  rule: 'network_failed' | 'rate_limited' | 'server_error' | 'invalid_payload' | 'invalid_consent_state' | 'invalid_event_time' | 'unsafe_endpoint';

  constructor(rule: AnalyticsError['rule'], message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AnalyticsError';
    this.rule = rule;
  }
}

// Reads the durable consent state. null = consent was never asked — the gate
// is closed for it (criterion 1: no consent, no sending). A stored value
// outside the closed vocabulary is corrupt durable state: a named
// diagnostic, never a silent "closed" (silent wrong behavior). The shared
// accessor (services/consent.ts) owns the vocabulary; the error class stays
// this module's contract.
export function getAnalyticsConsent(driver: SqlDriver): AnalyticsConsent | null {
  return readConsentState(driver, CONSENT_KEY, (key, stored) =>
    new AnalyticsError('invalid_consent_state', `settings.${key} holds an unknown value: ${stored}`),
  );
}

// Grants, refuses or withdraws analytics consent. Writing `revoked` over a
// previous `granted` is the withdrawal path: the queue and the local log are
// not touched (criterion 2 — only the sending stops).
export function setAnalyticsConsent(driver: SqlDriver, consent: AnalyticsConsent): void {
  setSetting(driver, CONSENT_KEY, consent);
}

// The consent-gated flush — the one send entry point the app composes over
// eventLog's queue. The durable state is read before the queue is touched
// (no in-memory second copy): without a granted consent flushAnalytics
// returns without reading pending rows, without constructing any network
// work and without marking anything — zero calls of the sender, not an
// empty batch (criterion 1: «ні пінгаў, ні batched»).
//
// The durable state is also re-read before EVERY batch inside the flush
// (network-privacy N2): a withdrawal that lands while an earlier batch is
// in flight stops the next batch before it starts, and the unacknowledged
// rows stay pending, unmarked. The recheck is eventLog's loop gate, not a
// wrapped sender: a resolving wrapper would let flushEvents mark the batch
// sent and silently retire never-sent events — exactly the queue loss
// criterion 2 forbids.
export async function flushAnalytics(driver: SqlDriver, send: EventSender): Promise<number> {
  if (getAnalyticsConsent(driver) !== 'granted') return 0;
  return flushEvents(driver, send, {
    beforeBatch: () => getAnalyticsConsent(driver) === 'granted',
  });
}

// The HTTP port — injectable so the transport is proven without a network
// (device.ts idiom); the default uses fetch.
export interface EventsHttpTransport {
  postEvents(url: string, body: unknown, headers: Record<string, string>): Promise<{ status: number; body: unknown }>;
}

function defaultHttpTransport(): EventsHttpTransport {
  return {
    async postEvents(url, body, headers) {
      // N3: the parsed URL is validated before the network and before the
      // Authorization header is attached (the header is built by the caller
      // but only reaches fetch past this check). Redirects are refused
      // twice: fetch runs with redirect: 'error', and a response that was
      // redirected anyway (a platform that ignored the option) is rejected
      // before its body is read — the batch is never sent to a foreign
      // origin with the device secret attached.
      let endpoint: URL;
      try {
        endpoint = parseSecureEndpointUrl(url, 'events send');
      } catch (error) {
        const message = error instanceof SecureUrlError
          ? error.message
          : 'events send: the endpoint URL is not parseable';
        throw new AnalyticsError('unsafe_endpoint', message, { cause: error });
      }
      let response: Response;
      try {
        response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error' });
        assertNotRedirected(endpoint, response, 'events send');
      } catch (error) {
        if (error instanceof SecureUrlError) {
          throw new AnalyticsError('unsafe_endpoint', error.message, { cause: error });
        }
        throw new AnalyticsError('network_failed', 'events send request failed', { cause: error });
      }
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

export interface EventsTransportDeps {
  /** Functions base URL, e.g. https://<ref>.supabase.co/functions/v1 */
  baseUrl: string;
  identity: DeviceIdentity;
  transport?: EventsHttpTransport;
}

// The wire shape of one event: the queued row verbatim, with `at` converted
// to the event table's ISO-8601 UTC timestamp. The payload goes out exactly
// as stored — the transport adds nothing (the allowlist is the server's
// enforcement, `09` §15; G09.01 left it there deliberately).
function toWireEvent(event: OutgoingEvent): Record<string, unknown> {
  if (!Number.isFinite(event.at)) {
    throw new AnalyticsError('invalid_event_time', `event ${event.event_id}: queued at is not a finite epoch ms number`);
  }
  return {
    event_id: event.event_id,
    type: event.type,
    at: new Date(event.at).toISOString(),
    schema_version: event.schema_version,
    payload: event.payload,
  };
}

// Maps the canonical POST /v1/events onto the functions base URL and wraps
// the closed response vocabulary in AnalyticsError rules: 400 invalid_event
// carries the server's reason, 429 is rate_limited (the queue stays pending,
// the caller's next flush retries), any other status is server_error. A
// resolved promise is the flush's mark signal — only a 200 resolves.
//
// A 400 is permanent for that batch — retrying resends the same ids and gets
// the same answer; what the caller does with an invalid_payload batch (drop,
// quarantine, DLQ) is the flush-caller's disposition, not this transport's
// (results G09.02.md — the queue is never silently cleaned here).
export function createEventsTransport(deps: EventsTransportDeps): EventSender {
  const http = deps.transport ?? defaultHttpTransport();
  return async (events) => {
    const body = { events: events.map(toWireEvent) };
    const response = await http.postEvents(
      `${deps.baseUrl}/events`,
      body,
      { authorization: `Bearer ${deps.identity.deviceSecret}`, 'content-type': 'application/json' },
    );
    if (response.status === 200) return;
    if (response.status === 400) {
      const reason = reasonFromBody(response.body);
      throw new AnalyticsError('invalid_payload', `events batch rejected: ${reason}`);
    }
    if (response.status === 429) {
      throw new AnalyticsError('rate_limited', 'events send is rate limited; retry later');
    }
    throw new AnalyticsError('server_error', `events send failed with status ${response.status}`);
  };
}

function reasonFromBody(body: unknown): string {
  const candidate = body as { error?: { reason?: unknown } } | null;
  const reason = candidate?.error?.reason;
  return typeof reason === 'string' && reason !== '' ? reason : 'invalid_event';
}

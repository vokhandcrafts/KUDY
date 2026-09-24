// G04.02.c — the AccessReady capability channel. The issuer is one:
// services/download, one app run (ADR G01.03 §3.5); the port is the typed
// channel of 19 §3.2 and the event object is built inside this module from
// the activation commit's own facts — the layer key and the activated
// package's route.json on disk. No exported surface accepts an event object,
// so an event built outside the module has no delivery path (criterion 1).
// Emission happens only in activate() after the commit (19 §3.5: successful
// activation is the single emission site); recovery on open emits nothing.
import type { RunEvent } from '../../core/engine/events.ts';
import type { LayerKey } from './types.ts';

// The full launch identity, copied from the 19 §3.2 handler type: the
// camelCase machine shape of core/engine/events.ts (ADR G01.03 §3.5 defines
// it snake_case; state.ts declares the boundary).
export type AccessReadyEvent = Extract<RunEvent, { type: 'AccessReady' }>;

// 19 §3.2, verbatim: the issuer is one — services/download, one app run
// (ADR G01.03 §3.5). Authenticity comes from the typed channel, not the
// issuer string; controller/UI/entitlement cannot emulate it.
export interface DownloadAccessPort {
  onAccessReady(handler: (event: AccessReadyEvent) => void): void;
}

// The delivery state of one port instance — the handlers to fan out to and
// the identities already emitted in this run (criterion 3: a repeated
// identity produces no second emission). Kept behind a WeakMap keyed by the
// port object: a port not created by createAccessPort() has no channel, so
// emission against it fails closed instead of delivering anywhere.
interface AccessChannel {
  handlers: Array<(event: AccessReadyEvent) => void>;
  emitted: Set<string>;
}

const channels = new WeakMap<object, AccessChannel>();

// The dedupe identity of ADR G01.03 §3.5: route_id, version, locale, tier.
// JSON-joined so distinct field combinations can never collide on a
// separator character the safe-path idiom happens to allow.
function identityOf(key: LayerKey): string {
  return JSON.stringify([key.routeId, key.version, key.locale, key.tier]);
}

export function createAccessPort(): DownloadAccessPort {
  const channel: AccessChannel = { handlers: [], emitted: new Set() };
  const port: DownloadAccessPort = {
    onAccessReady(handler) {
      channel.handlers.push(handler);
    },
  };
  channels.set(port, channel);
  return port;
}

// The unlock payload of the activated layer: the ids of the route stops
// whose access_tier names this tier. The route's stops live in route.json at
// the package root — the RouteStop of 09 §3 ({id, position, place_id,
// access_tier}, contracts/schemas/route.schema.json + stop.schema.json; the
// per-layer stops.json carries stories, not stops). A stop without a string
// id cannot name content and is skipped; the document identity is checked
// against the activation key (the sibling idiom of
// services/contentRepo/contentRepo.ts route.json#identity-mismatch) — an
// unreadable, invalid or foreign document yields an empty list plus a named
// diagnostic (implementation-rules 14: diagnostics, not a crash) — the
// reducer widens the tier for an empty payload and re-checks every id
// against the pinned package (ADR G01.03 §3.5 check 5).
export function parseRouteStops(
  bytes: Uint8Array,
  key: LayerKey,
): { stopIds: string[]; diagnostic?: string } {
  let doc: unknown;
  try {
    doc = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { stopIds: [], diagnostic: 'access#route-json-invalid' };
  }
  const routeDoc = doc as { route_id?: unknown; version?: unknown; stops?: unknown } | null;
  if (routeDoc?.route_id !== key.routeId || routeDoc?.version !== key.version) {
    return { stopIds: [], diagnostic: 'access#route-json-identity' };
  }
  if (!Array.isArray(routeDoc.stops)) return { stopIds: [], diagnostic: 'access#route-json-invalid' };
  const stopIds = routeDoc.stops
    .filter(
      (stop): stop is { id: string } =>
        stop !== null &&
        typeof stop === 'object' &&
        typeof (stop as { id?: unknown }).id === 'string' &&
        (stop as { access_tier?: unknown }).access_tier === key.tier,
    )
    .map((stop) => stop.id);
  return { stopIds };
}

/**
 * Build and deliver the event of one activation commit. Called only by
 * activate() after the commit (19 §3.5): the identity comes from the
 * committed layer key, the stop ids from the activated package's route.json
 * — never from a caller (criterion 2). Delivery through a port that
 * createAccessPort() did not create fails closed with a diagnostic; a
 * handler that throws is isolated — the remaining handlers still receive
 * the event, and the failure is surfaced in the diagnostics, never
 * swallowed (the commit already happened, so a lost notification would be
 * unrecoverable within this run).
 */
export async function emitAccessReady(
  access: DownloadAccessPort,
  key: LayerKey,
  readPackageFile: (rel: string) => Promise<Uint8Array | null>,
): Promise<string[]> {
  const channel = channels.get(access);
  if (!channel) return ['access#no-channel'];
  const identity = identityOf(key);
  if (channel.emitted.has(identity)) return [];

  // The read is isolated like the handlers below: the commit already
  // happened, so a rejecting store port (a device IO fault, not an absent
  // file) must degrade to an empty payload with a diagnostic, never wedge
  // the activation after its own commit.
  let bytes: Uint8Array | null = null;
  let readFailed = false;
  try {
    bytes = await readPackageFile('route.json');
  } catch {
    readFailed = true;
  }
  const parsed = readFailed
    ? { stopIds: [], diagnostic: 'access#route-json-unreadable' as const }
    : bytes === null
      ? { stopIds: [], diagnostic: 'access#route-json-missing' as const }
      : parseRouteStops(bytes, key);
  const event: AccessReadyEvent = {
    type: 'AccessReady',
    routeId: key.routeId,
    version: key.version,
    locale: key.locale,
    tier: key.tier,
    stopIds: parsed.stopIds,
    issuer: 'services/download',
  };
  channel.emitted.add(identity);
  const diagnostics: string[] = [];
  if (parsed.diagnostic) diagnostics.push(parsed.diagnostic);
  for (const handler of channel.handlers) {
    try {
      handler(event);
    } catch (error) {
      diagnostics.push(
        `access#handler-threw:${error instanceof Error && error.message !== '' ? error.message : 'unknown-error'}`,
      );
    }
  }
  return diagnostics;
}

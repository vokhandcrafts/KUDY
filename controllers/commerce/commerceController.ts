// G08.05 (issue #292) — the quiet commerce controller behind the guide
// preview: the upgrade offer's visibility, the purchase attempt's error
// exits and the local telemetry facts. One instance per opened route (the
// preview controller idiom; the composition root hands the factory when the
// commerce port exists). Canon anchors, copied not paraphrased
// (implementation-rules 2):
// `11` C26 — «Спакойная прапанова ўнізе апісання даступная і да першага
// праслухоўвання; у Run яна не паказваецца ў Peek або падчас аўдыё і
// паважае Continue free». The offer's only home is the preview surface —
// the Run surface never renders it, so audio is never interrupted (AC1);
// its availability is not gated on any listening fact (C26: і да першага
// праслухоўвання).
// `11` D06/NAV6 — «Націск на платную прапанову або замкнёную кропку
// адкрывае прэв'ю; ён не купляе…»; «Пакупка, загрузка і Start — асобныя
// дзеянні». The card itself buys nothing — the Buy press inside is the
// separate explicit action.
// `11` C28 — «Памылка пакупкі пакідае абодва выхады — Try again і Continue
// free — і не губляе кропку». Every error state renders both exits (AC2);
// the owned fact never regresses and no point is lost.
// `11` §8 verbatim — «Куплена · трэба загрузіць», the honest words after
// the store leg finished (the store fact, never a right: `09` §5.1 —
// «Кліент ніколі не сцвярджае, што ён нешта купіў»; the server grant
// decides, the download stays the preview's own explicit Download action).
//
// Events restate contracts/events/event-table.v1.json verbatim — the field
// names stay snake_case at this boundary, the single mapping point between
// the contract and the code (implementation-rules 2): extension_offer_shown
// / extension_offer_accepted, purchase_started / purchase_succeeded /
// purchase_failed with the reason enum narrowed to the failed event (the
// table's rule) and purchase_started carrying the offer_id it came from
// (the join rule). The impression event fires from the render fact
// (AC3: «фактычная бачнасць… падзея — G01.05»; the table's anchor: «паказ —
// толькі фактычная бачнасць») — the layout callback of the offer card, one
// record per continuous visibility period, never from the mount itself.
// Recording policy verbatim (the table): local_recording always,
// sending consent-gated — this port only records locally; the consented
// sender is G09's and joins later behind the same seam.
import { createControllerStore, type ControllerStore } from '../createControllerStore.ts';
import type { PurchaseChainState } from '../../services/entitlement/purchase-chain.ts';
import type { PurchaseOutcome } from '../../services/entitlement/types.ts';
// G21.09 (issue #542): the message shapes live in the shared pure contract zone.
import type { OfferStrings } from '../../contracts/ui-message-types.ts';
import { OFFER_STRINGS_DATA } from './commerce-strings.generated.ts';

// The composition-root seam (G08.04 Рашэнне 1: «G08.05 чытае stateOf() для
// выбару Buy/Download»). The root resolves it from the store session (the
// G08.03 service) and the purchase-chain state when those adapters exist;
// absent, the preview renders no offer — fail closed, the idiom of every
// optional port (never a fictional state). The port owns the state behind
// both members: its own `purchase` MUST update whatever fact its `stateOf`
// answers — a finished store leg lands 'paid' (the §8 words show, the offer
// never returns). Wiring `stateOf` to the G08.04 chain while calling
// `purchaseNonConsumable` directly leaves the finished leg invisible to
// `stateOf` and re-offers a paid product — that wiring is wrong by this
// contract, not by the controller's.
export interface CommercePort {
  // The honest client-side purchase state of one product (G08.04's
  // PurchaseChainState, verbatim).
  readonly stateOf: (productId: string) => PurchaseChainState;
  // One purchase attempt through the store session (G08.03
  // purchaseNonConsumable): resolves with the closed PurchaseOutcome —
  // never rejects (the store-error mapping's own contract), never asserts
  // a right. The download leg stays outside: the preview's Download button
  // is that separate action (D06, `11` §8).
  readonly purchase: (productId: string) => Promise<PurchaseOutcome>;
}

// The local telemetry seam. The record's shape is the contract restatement
// (event-table.v1.json, verbatim snake_case); the recorder is a sink, not
// an interpreter.
export interface TelemetryPort {
  readonly record: (event: CommerceEventRecord) => void;
}

export type CommerceEventType =
  | 'extension_offer_shown'
  | 'extension_offer_accepted'
  | 'purchase_started'
  | 'purchase_succeeded'
  | 'purchase_failed';

// The failed event's reason enum, verbatim from the table's `reason` field.
export type PurchaseFailureReason =
  | 'user_cancelled'
  | 'payment_failed'
  | 'verification_unavailable';

export interface CommerceEventRecord {
  readonly type: CommerceEventType;
  // The table's common fields: the client mints the uuid and the timestamp.
  readonly event_id: string;
  readonly at: string;
  readonly schema_version: 1;
  // The context the table requires of these types: route_id for the offer
  // pair, route_id + tier for the purchase triple. The no-session rule
  // holds by construction: preview commerce runs before Start, and the
  // table forbids a minted session_id there («Пакупка… да Start не
  // атрымліваюць выдуманай сесіі»).
  readonly route_id: string;
  readonly tier?: 'base' | 'extended';
  // The fields of the concrete types: offer_id (required on the offer pair,
  // carried by purchase_started per the join rule), attempt_id (required on
  // the purchase triple), stop_id (never set here — the offer is route-wide,
  // not stop-anchored), reason (the failed event only).
  readonly offer_id?: string;
  readonly attempt_id?: string;
  readonly stop_id?: string;
  readonly reason?: PurchaseFailureReason;
}

// The offer's visibility, the fact the screen renders. 'offered' — the card
// shows; 'dismissed' — the decline is respected (AC4); 'paid' — the store
// leg finished, the §8 words show; 'none' — nothing commerce renders (free
// access, no product fact, or the chain already reached 'ready').
export type OfferVisibility = 'offered' | 'dismissed' | 'paid' | 'none';

export interface OfferInput {
  readonly access: 'free' | 'paid' | 'mixed';
  readonly productId: string | null;
  readonly chainState: PurchaseChainState;
  readonly dismissed?: boolean;
}

// The pure visibility derivation (the Proof target: reverting any branch —
// e.g. the dismissal check — fails the meaning tests). The MVP scope is the
// paid route: the catalog's route document names its product_id_route, and
// the chain's 'not-owned' state means the purchase path may be offered.
// Mixed routes' extension offers need the route document's
// product_id_extension fact and are consciously deferred (the results file
// records the decision).
export function deriveOffer(input: OfferInput): OfferVisibility {
  if (input.productId === null) return 'none';
  if (input.chainState === 'paid') return 'paid';
  if (input.chainState === 'ready') return 'none';
  if (input.dismissed === true) return 'dismissed';
  if (input.access === 'paid') return 'offered';
  return 'none';
}

// The closed outcome → the table's three-value reason enum. The single
// mapping point: the success kinds never reach it (the controller splits
// them first), every other closed kind lands on one of the enum's values —
// no invented fourth reason, no raw store vocabulary.
export function purchaseFailureReason(outcome: PurchaseOutcome): PurchaseFailureReason {
  switch (outcome.kind) {
    case 'cancelled':
      return 'user_cancelled';
    case 'payment-pending':
    case 'not-allowed':
    case 'product-unavailable':
    case 'store-problem':
      return 'payment_failed';
    case 'unavailable':
    case 'executor-error':
    case 'invalid-input':
    case 'unknown':
      return 'verification_unavailable';
    // The success kinds are unreachable here (the controller splits before
    // calling); a runtime shape outside the closed union still answers with
    // a diagnostic value instead of crashing (implementation-rules 14).
    default:
      return 'verification_unavailable';
  }
}

// The attempt's state: the error state is the C28 dialog — both exits
// always render while it holds.
export type AttemptState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'error'; readonly reason: PurchaseFailureReason };

export interface CommerceControllerState {
  readonly offer: OfferVisibility;
  readonly attempt: AttemptState;
  readonly busy: boolean;
  // The preview's load fact: the access kind and the route document's
  // product. Called by the screen when the preview loads; re-derives the
  // offer and arms one impression per new visibility period.
  readonly sync: (facts: { access: 'free' | 'paid' | 'mixed'; productId: string | null }) => void;
  // The card's layout fact (AC3): exactly one extension_offer_shown per
  // continuous visibility period, never on the mount alone.
  readonly markRendered: () => void;
  // The explicit purchase action (D06: асобнае дзеянне). A double-tap is a
  // no-op while an attempt runs; nothing records and nothing calls the port.
  readonly buy: () => Promise<void>;
  // The C28 error dialog's Try again: a fresh attempt (a new attempt_id),
  // still carrying the offer_id it came from (the join rule).
  readonly tryAgain: () => Promise<void>;
  // The C28 error dialog's Continue free: the dialog closes, the app keeps
  // working free and the offer card stays — the person may buy later, and
  // C26's «паважае Continue free» holds. The system Back runs this too.
  readonly continueFree: () => void;
  // The decline (AC4): the same offer never returns in the same context —
  // the card is gone for this controller instance's lifetime.
  readonly dismiss: () => void;
}

export interface CommerceDeps {
  readonly port: CommercePort;
  readonly telemetry?: TelemetryPort;
  readonly routeId: string;
  // The offer's identity for the event joins (the identifier pattern of the
  // table): one mint per controller instance — one offer per route context.
  readonly mintOfferId?: () => string;
  readonly mintAttemptId?: () => string;
  // The table's common fields: the uuid mint and the ISO clock. The
  // composition root passes its device-safe mints when it wires the port;
  // the defaults serve the Node tests.
  readonly mintEventId?: () => string;
  readonly now?: () => string;
}

export function createCommerceController(deps: CommerceDeps): ControllerStore<CommerceControllerState> {
  const now = deps.now ?? (() => new Date().toISOString());
  const mintEventId = deps.mintEventId ?? (() => crypto.randomUUID());
  const mintAttemptId = deps.mintAttemptId ?? (() => crypto.randomUUID());
  let offerCounter = 0;
  const offerId = deps.mintOfferId?.() ?? `offer-${++offerCounter}`;
  let access: 'free' | 'paid' | 'mixed' = 'free';
  let productId: string | null = null;
  let dismissed = false;
  // One impression per continuous visibility period (AC3): armed when the
  // derivation newly lands on 'offered', spent by the layout fact.
  let impressionArmed = false;

  const record = (
    event: Omit<CommerceEventRecord, 'event_id' | 'at' | 'schema_version'>,
  ): void => {
    deps.telemetry?.record({
      ...event,
      event_id: mintEventId(),
      at: now(),
      schema_version: 1,
    });
  };

  const derive = (): OfferVisibility =>
    productId === null
      ? 'none'
      : deriveOffer({ access, productId, chainState: deps.port.stateOf(productId), dismissed });

  const store = createControllerStore<CommerceControllerState>((set, get) => {
    async function attemptPurchase(): Promise<void> {
      if (productId === null) return;
      const attemptId = mintAttemptId();
      record({
        type: 'purchase_started',
        attempt_id: attemptId,
        offer_id: offerId,
        route_id: deps.routeId,
        tier: 'extended',
      });
      set({ attempt: { kind: 'busy' }, busy: true });
      const outcome = await deps.port.purchase(productId);
      if (outcome.kind === 'transaction-finished' || outcome.kind === 'already-owned') {
        // The store leg finished (or the store refused a second charge):
        // the §8 words show, the offer never returns. The download stays
        // the preview's own separate Download action (D06).
        record({
          type: 'purchase_succeeded',
          attempt_id: attemptId,
          route_id: deps.routeId,
          tier: 'extended',
        });
        set({ attempt: { kind: 'idle' }, busy: false, offer: derive() });
        return;
      }
      const reason = purchaseFailureReason(outcome);
      record({
        type: 'purchase_failed',
        attempt_id: attemptId,
        reason,
        route_id: deps.routeId,
        tier: 'extended',
      });
      // The person's own answer is not an error: the event is recorded (the
      // enum's user_cancelled exists for exactly this), the card returns to
      // its quiet state with no dialog. Every other failure opens the C28
      // state — both exits render while it holds.
      set(
        reason === 'user_cancelled'
          ? { attempt: { kind: 'idle' }, busy: false }
          : { attempt: { kind: 'error', reason }, busy: false },
      );
    }

    return {
      offer: 'none',
      attempt: { kind: 'idle' },
      busy: false,
      sync: (facts) => {
        const previous = derive();
        access = facts.access;
        productId = facts.productId;
        const next = derive();
        if (next === 'offered' && previous !== 'offered') impressionArmed = true;
        // The screen's effect calls this per surface change; the store only
        // notifies on a real transition, so the loop terminates here.
        if (get().offer !== next) set({ offer: next });
      },
      markRendered: () => {
        if (!impressionArmed || productId === null) return;
        impressionArmed = false;
        record({ type: 'extension_offer_shown', offer_id: offerId, route_id: deps.routeId });
      },
      buy: async () => {
        if (productId === null || get().busy || get().offer !== 'offered') return;
        record({ type: 'extension_offer_accepted', offer_id: offerId, route_id: deps.routeId });
        await attemptPurchase();
      },
      tryAgain: async () => {
        if (get().attempt.kind !== 'error') return;
        await attemptPurchase();
      },
      continueFree: () => {
        if (get().attempt.kind !== 'error') return;
        set({ attempt: { kind: 'idle' } });
      },
      dismiss: () => {
        if (productId === null) return;
        dismissed = true;
        impressionArmed = false;
        set({ offer: derive() });
      },
    };
  });
  return store;
}

// The commerce words, per the display locale (the previewStrings idiom: the
// codes live in the state, these are the words; an unknown locale falls
// back to Belarusian, the app's first preference).
export type { OfferStrings } from '../../contracts/ui-message-types.ts';

const OFFER_STRINGS = OFFER_STRINGS_DATA;

export function offerStrings(locale: string): OfferStrings {
  return locale === 'es' ? OFFER_STRINGS.es : locale === 'de' ? OFFER_STRINGS.de : locale === 'en' ? OFFER_STRINGS.en : locale === 'uk' ? OFFER_STRINGS.uk : OFFER_STRINGS.be;
}

// G16.03 (issue #74) — the voluntary private rating controller (`21` §2: the
// form, the purpose disclosure, edit/delete; nothing sends without the
// explicit press). The value lifecycle lives in services/feedbackRepository
// (G16.02) and the delivery in services/feedbackSync — this controller binds
// them to the UI state: the once-per-session End invitation (20 §7), the
// 1–5 form with no preselected star, the kind-closed reasons, the Send
// separated from the analytics consent and the honest delivery states.
//
// Boundaries (ADR G01.03 §3.1, `21` §2): the target arrives bound from the
// surface — the used guide version/locale of the ended session or the opened
// place card's content version/locale — and is never re-read from a fresh
// catalog here (submission reads no catalog). The controller holds no
// telemetry reference: feedback never rides the events path (acceptance 4).
// The disclosure text version is the client half of the server allowlist
// (supabase/functions/feedback/feedback-core.ts DISCLOSURE_VERSIONS); a new
// text version amends both sides in the same change.
import type * as feedbackRepository from '../services/feedbackRepository.ts';
import type { FeedbackStateView, FeedbackTarget } from '../services/feedbackRepository.ts';
import type { FeedbackSync } from '../services/feedbackSync.ts';
import type { SqlDriver } from '../services/db/types.ts';
import { FEEDBACK_STRINGS_DATA } from './feedback-strings.generated.ts';
import type { FeedbackStrings } from '../contracts/ui-message-types.ts';
import { createControllerStore, type ControllerStore } from './createControllerStore.ts';
import { useStoreState } from './useControllerStore.ts';

export type { FeedbackStrings } from '../contracts/ui-message-types.ts';
// The UI layer keeps importing its view types from the controllers (the
// nearby controller's re-export idiom): the own-rating row's view type.
export type { FeedbackStateView, FeedbackTarget } from '../services/feedbackRepository.ts';

// The repository seam (the controllers' port idiom — the composition root is
// the one module that value-imports services and passes the module's own
// operations here; the controller restates nothing). FeedbackError rides the
// port because the error's rule is the UI diagnostic contract.
export type FeedbackRepositoryPort = Pick<
  typeof feedbackRepository,
  'deleteFeedback' | 'formatTargetKey' | 'FeedbackError' | 'getFeedbackState' | 'listFeedbackStates' | 'saveDraft' | 'sendNow'
>;

// `21` §6 verbatim value; the server validates it against its allowlist
// (feedback-core.ts: `['feedback-disclosure-1']`).
export const FEEDBACK_DISCLOSURE_VERSION = 'feedback-disclosure-1';

// The closed reason vocabulary of `21` §5.1, verbatim codes. The form offers
// only its kind's list — a guide audio complaint can never land on a place
// score (acceptance 3).
export const GUIDE_REASONS = [
  'interesting_stories',
  'clear_delivery',
  'too_long',
  'hard_to_navigate',
  'audio_problem',
  'description_mismatch',
] as const;

export const PLACE_REASONS = [
  'worth_visiting',
  'description_mismatch',
  'hard_to_reach',
  'access_problem',
] as const;

export function reasonsFor(kind: FeedbackTarget['kind']): readonly string[] {
  return kind === 'guide' ? GUIDE_REASONS : PLACE_REASONS;
}

// The form route's params are untrusted input: the target's closed patterns
// (kind, id, version, locale — services/feedbackRepository validation) are
// the gate, run here so the app/ layer never imports services/ (19 §4.2). A
// failing triple answers null and the route renders its honest
// incomplete-link state, never a guess.
// The surface words (the runMapStrings idiom; the inventory guard walks this
// selector against the canonical records).
const STRINGS = FEEDBACK_STRINGS_DATA;

export function feedbackStrings(locale: string): FeedbackStrings {
  return locale === 'de' ? STRINGS.de : locale === 'en' ? STRINGS.en : locale === 'uk' ? STRINGS.uk : STRINGS.be;
}

// The delivery word of the §5.4 states, shared by the form route and the
// My KUDY list (one mapping — the screens never restate it); the raw kind is
// never rendered — the closed word map covers every state the controller
// produces.
export function feedbackDeliveryWord(
  delivery: FeedbackDelivery,
  strings: FeedbackStrings,
): string {
  switch (delivery.kind) {
    case 'draft':
      return strings.stateDraft;
    case 'pending':
      return delivery.deletePending ? strings.stateDeletePending : strings.statePending;
    case 'sent':
      return strings.stateSent;
    case 'conflict':
      return strings.stateConflict;
    case 'action_required':
      return strings.stateActionRequired;
    default:
      return '';
  }
}

// The delivery half of `21` §5.4 the UI renders: draft → pending → sent,
// 409 → conflict, 401/422 → action_required; a queued tombstone is the
// delete-pending state («выдаленне чакае сеткі»).
export type FeedbackDelivery =
  | { readonly kind: 'none' }
  | { readonly kind: 'draft' }
  | { readonly kind: 'pending'; readonly deletePending: boolean }
  | { readonly kind: 'sent'; readonly score: number | null }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'action_required' };

export type FeedbackFormState =
  | { readonly kind: 'closed' }
  | {
      readonly kind: 'open';
      readonly target: FeedbackTarget;
      // No preselected star: a fresh form opens with null (20 §7); an edit
      // preselects the person's own previous choice, never a default.
      readonly score: number | null;
      readonly reasons: readonly string[];
      readonly delivery: FeedbackDelivery;
      readonly busy: boolean;
      // The last synchronous failure's named rule (a write/transport fault
      // the delivery states do not cover) — rendered as the diagnostic and
      // cleared by the next round or a reopen.
      readonly error: string | null;
    };

export interface FeedbackInvitation {
  readonly sessionId: string;
  // The ended session's own identity: the walk's pinned version/locale, not
  // a catalog read (acceptance 5).
  readonly target: FeedbackTarget;
}

export type FeedbackUiState = {
  readonly form: FeedbackFormState;
  readonly invitation: FeedbackInvitation | null;
  // The own ratings (My KUDY): every target with a local row, the store's
  // own order (21 §2: the own list is visible to the person).
  readonly items: readonly FeedbackStateView[];

  // Only local guide use invites (20 §7: one story is also experience; zero
  // heard stories is no use to rate) and only once per session id.
  readonly offerEndInvitation: (input: {
    sessionId: string;
    routeId: string;
    version: string;
    locale: string;
    heardCount: number;
  }) => void;
  readonly dismissInvitation: () => void;
  // An edit preselects the desired value (a put draft with its reasons),
  // else the acknowledged score; a fresh target opens without a star.
  readonly openForm: (target: FeedbackTarget) => void;
  readonly setScore: (score: number) => void;
  readonly toggleReason: (code: string) => void;
  readonly closeForm: () => void;
  // The explicit send: draft + outbox op before the network, then one flush
  // round. Refuses without a chosen star (no default, 20 §7).
  readonly send: () => Promise<void>;
  readonly remove: () => Promise<void>;
  // The own-state read that resolves a conflicted target (`21` §5.3).
  readonly resolveConflict: () => Promise<void>;
  readonly refreshItems: () => void;
  // The route's untrusted params through the repository's target validation;
  // null — the honest incomplete-link state.
  readonly parseTarget: (input: {
    kind?: unknown;
    id?: unknown;
    version?: unknown;
    locale?: unknown;
  }) => FeedbackTarget | null;
};

// The named synchronous-failure rule in words (the feedbackDeliveryWord
// idiom): a machine rule code never shows alone — an unknown rule renders
// raw as the last resort.
export function feedbackErrorWord(rule: string, strings: FeedbackStrings): string {
  return strings.errorText[rule] ?? rule;
}

// The store-side view → the rendered delivery state; exported for the My
// KUDY list whose rows carry the same store views the form renders.
export function deliveryOfView(view: FeedbackStateView | null): FeedbackDelivery {
  return deliveryOf(view);
}

function deliveryOf(view: FeedbackStateView | null): FeedbackDelivery {
  if (view === null) return { kind: 'none' };
  if (view.state === 'draft') return { kind: 'draft' };
  if (view.state === 'pending' || view.state === 'sending')
    return { kind: 'pending', deletePending: view.inFlight?.value.op === 'delete' };
  if (view.state === 'sent') return { kind: 'sent', score: view.score };
  if (view.state === 'conflict') return { kind: 'conflict' };
  return { kind: 'action_required' };
}

export function createFeedbackController(deps: {
  driver: SqlDriver;
  sync: FeedbackSync;
  repository: FeedbackRepositoryPort;
  now?: () => number;
  // Deterministic mutation ids for the tests; the default mints UUIDs (the
  // repository's own default — this is only the injection seam).
  makeMutationId?: () => string;
}): ControllerStore<FeedbackUiState> {
  const now = deps.now ?? (() => Date.now());
  const makeMutationId = deps.makeMutationId ?? (() => crypto.randomUUID());
  // The form route's params are untrusted input: the target's closed
  // patterns (kind, id, version, locale — the repository's own validation)
  // are the gate. A failing triple answers null and the route renders its
  // honest incomplete-link state, never a guess.
  const parseTarget = (input: {
    kind?: unknown;
    id?: unknown;
    version?: unknown;
    locale?: unknown;
  }): FeedbackTarget | null => {
    const one = (value: unknown): string => (typeof value === 'string' ? value : '');
    const kind = one(input.kind);
    if (kind !== 'guide' && kind !== 'place') return null;
    const target: FeedbackTarget = { kind, id: one(input.id), version: one(input.version), locale: one(input.locale) };
    try {
      deps.repository.formatTargetKey(target);
    } catch {
      return null;
    }
    return target;
  };
  // Once per session (20 §7): the End invitation is offered for a session id
  // exactly once per app run — a dismissal or a later edit is never undone.
  const offeredSessions = new Set<string>();
  const store = createControllerStore<FeedbackUiState>((set, get) => ({
    form: { kind: 'closed' },
    invitation: null,
    items: deps.repository.listFeedbackStates(deps.driver),

    // Only local guide use invites (20 §7: one story is also experience;
    // zero heard stories is no use to rate) and only once per session.
    offerEndInvitation(input: {
      sessionId: string;
      routeId: string;
      version: string;
      locale: string;
      heardCount: number;
    }): void {
      if (input.heardCount < 1 || offeredSessions.has(input.sessionId)) return;
      offeredSessions.add(input.sessionId);
      set({
        invitation: {
          sessionId: input.sessionId,
          target: { kind: 'guide', id: input.routeId, version: input.version, locale: input.locale },
        },
      });
    },

    dismissInvitation(): void {
      if (get().invitation === null) return;
      set({ invitation: null });
    },

    openForm(target: FeedbackTarget): void {
      const view = deps.repository.getFeedbackState(deps.driver, target);
      // An edit preselects the desired value (a put draft with its reasons),
      // else the acknowledged score; a fresh target opens without a star.
      const desired = view?.draft ?? null;
      const score =
        desired?.op === 'put' ? desired.score : view !== null && view.score !== null ? view.score : null;
      set({
        form: {
          kind: 'open',
          target,
          score,
          reasons: desired?.op === 'put' ? [...desired.reasonCodes] : [],
          delivery: deliveryOf(view),
          busy: false,
          error: null,
        },
      });
    },

    setScore(score: number): void {
      const form = get().form;
      if (form.kind !== 'open') return;
      if (!Number.isInteger(score) || score < 1 || score > 5) {
        throw new deps.repository.FeedbackError('feedback-input-invalid', 'score: must be an integer 1..5');
      }
      set({ form: { ...form, score, error: null } });
    },

    toggleReason(code: string): void {
      const form = get().form;
      if (form.kind !== 'open') return;
      if (!reasonsFor(form.target.kind).includes(code)) {
        // A foreign-kind reason is a form bug, not a user state — the named
        // rule fails the suite that forced it (acceptance 3).
        throw new deps.repository.FeedbackError('feedback-input-invalid', `reasonCodes: ${code} is not a ${form.target.kind} reason`);
      }
      const reasons = [...form.reasons];
      const at = reasons.indexOf(code);
      if (at >= 0) {
        reasons.splice(at, 1);
      } else {
        if (reasons.length >= 3) {
          throw new deps.repository.FeedbackError('feedback-input-invalid', 'reasonCodes: at most 3 reasons');
        }
        reasons.push(code);
      }
      set({ form: { ...form, reasons, error: null } });
    },

    closeForm(): void {
      if (get().form.kind === 'closed') return;
      set({ form: { kind: 'closed' } });
    },

    send(): Promise<void> {
      const form = get().form;
      if (form.kind !== 'open') return Promise.resolve();
      if (form.score === null) {
        // The Send stays disabled without a star; a forced call is a named
        // refusal, never a silent send (20 §7: no default value).
        return Promise.reject(new deps.repository.FeedbackError('feedback-input-invalid', 'send: no score chosen'));
      }
      const target = form.target;
      const score = form.score;
      const reasons = [...form.reasons];
      return runMutation(() => {
        deps.repository.saveDraft(
          deps.driver,
          target,
          { score, reasonCodes: reasons, disclosureVersion: FEEDBACK_DISCLOSURE_VERSION },
          { now: now() },
        );
        deps.repository.sendNow(deps.driver, target, { now: now(), mutationId: makeMutationId() });
      });
    },

    remove(): Promise<void> {
      const form = get().form;
      if (form.kind !== 'open') return Promise.resolve();
      const target = form.target;
      return runMutation(() => {
        const outcome = deps.repository.deleteFeedback(deps.driver, target, { now: now(), mutationId: makeMutationId() });
        // The rating is gone locally and nothing is owed to the server —
        // the form has nothing left to render.
        if (outcome.outcome === 'cleared' || outcome.outcome === 'nothing') {
          set({ form: { kind: 'closed' } });
        }
      });
    },

    resolveConflict(): Promise<void> {
      const form = get().form;
      if (form.kind !== 'open') return Promise.resolve();
      const target = form.target;
      // The own-state read resolves the stuck mutations away (`21` §5.3);
      // the view renders the acknowledged truth afterwards.
      return withRound(async () => {
        await deps.sync.resolveConflict(target);
      });
    },

    refreshItems(): void {
      set({ items: deps.repository.listFeedbackStates(deps.driver) });
    },

    parseTarget,
  }));

  // The form's delivery line re-reads the store truth (the one mapping
  // through deliveryOf) — before and after every round.
  const refreshFormDelivery = (): void => {
    const current = store.getState().form;
    if (current.kind !== 'open') return;
    store.setState({ form: { ...current, delivery: deliveryOf(deps.repository.getFeedbackState(deps.driver, current.target)) } });
  };

  // One delivery round at a time: the repository writes land, the queued
  // truth renders immediately (a queued delete is the delete-pending state
  // before the fetch starts), then the flush runs and the settled truth
  // renders again. A named FeedbackError lands in the form's error line —
  // never a silent swallow.
  const withRound = async (body: () => Promise<void>): Promise<void> => {
    const form = store.getState().form;
    if (form.kind !== 'open') return;
    store.setState({ form: { ...form, busy: true, error: null } });
    try {
      await body();
    } catch (error) {
      const rule = error instanceof deps.repository.FeedbackError ? error.rule : 'feedback-write-failed';
      const current = store.getState().form;
      if (current.kind === 'open') store.setState({ form: { ...current, error: rule } });
    } finally {
      refreshFormDelivery();
      store.setState({ items: deps.repository.listFeedbackStates(deps.driver) });
      const settled = store.getState().form;
      if (settled.kind === 'open') store.setState({ form: { ...settled, busy: false } });
    }
  };

  const runMutation = (action: () => void): Promise<void> =>
    withRound(async () => {
      action();
      refreshFormDelivery();
      await deps.sync.flush();
    });

  return store;
}

// The screen binding (19 §2.2): the shared null-tolerant subscription — the
// root constructs the feedback member only with its ports, and the surfaces
// render their honest unavailable state without one.
export function useFeedbackState(store: ControllerStore<FeedbackUiState> | null | undefined): FeedbackUiState | null {
  return useStoreState(store);
}

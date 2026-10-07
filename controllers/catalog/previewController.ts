// G06.01.b (issue #314) — the guide preview controller: the vanilla store
// (the G06.09.b helper) behind the RouteDetail surface. One instance per
// opened route (the composition root hands the factory, the screen creates
// per mount), so the preview state lives per route_id. The main button's
// meaning derives from the real package facts — the layer's inventory state
// (09 §7: not_downloaded → partial → ready → stale) plus the contentRepo
// verify verdict — never from fiction; a port that does not exist keeps the
// button fail-closed with its named reason (11 §7), it never guesses a ready
// package. Ports only: the root constructs what its adapters allow (TR-10
// filesystem, the download channel, the session read); Node tests pass fakes.
import { createControllerStore, type ControllerStore } from '../createControllerStore.ts';
import type {
  CatalogService,
  GuidePreview,
  PreviewLoadState,
} from '../../services/catalog/types.ts';
import type { InventoryState, Readiness, Tier } from '../../services/contentRepo/types.ts';
import type { ActivationResult, LayerKey } from '../../services/download/types.ts';
import { PREVIEW_STRINGS_DATA } from './preview-strings.generated.ts';

// The surface the preview was opened from (11 §16.2): the MVP chain knows
// the city card and the «Гіды» rubric; the collection, the discovery result
// and the R07 hint join when their surfaces land (G15, G07.02, G07.04) —
// the registry already accepts them. An unrecognized value records nothing
// (no unvalidated echo).
export type SourceSurface = 'city' | 'rubric' | 'discovery' | 'collection' | 'hint';

const SOURCE_SURFACES: readonly SourceSurface[] = ['city', 'rubric', 'discovery', 'collection', 'hint'];

export function asSourceSurface(value: unknown): SourceSurface | null {
  return typeof value === 'string' && (SOURCE_SURFACES as readonly string[]).includes(value)
    ? (value as SourceSurface)
    : null;
}

// The asked layer's disk facts — the preview button's inventory input. State
// names verbatim from 09 §7; missingCount is the partial detail («N файлаў
// не хапае»), null when unknowable.
export interface PreviewLayerFacts {
  readonly state: InventoryState;
  readonly missingCount: number | null;
}

export interface PreviewInventoryPort {
  layerState(input: {
    routeId: string;
    version: string;
    locale: string;
    tier: Tier;
  }): Promise<PreviewLayerFacts>;
}

// The contentRepo verify verdict for the asked package (the Start gate, the
// same evaluation the run controller performs before its INSERT).
export interface PreviewEvaluatePort {
  evaluate(input: {
    routeId: string;
    version: string;
    locale: string;
    tier: Tier;
  }): Promise<Readiness>;
}

// The G04.02 activation channel: Download triggers it; the button flips to
// Start from the refreshed inventory facts afterwards — never from the
// activation result itself (the state follows the inventory).
export interface PreviewDownloadPort {
  activate(key: LayerKey): Promise<ActivationResult>;
}

// The read-only live-session fact (ADR G01.03 §3.1: at most one active or
// paused row app-wide). Start of another guide with a live session opens the
// single §4.1 confirm dialog; the preview never writes sessions.
export interface PreviewRunSessionPort {
  liveSession(): { routeId: string; title: string } | null;
}

export interface PreviewPorts {
  readonly service: CatalogService;
  readonly inventory?: PreviewInventoryPort;
  readonly evaluate?: PreviewEvaluatePort;
  readonly download?: PreviewDownloadPort;
  readonly runSession?: PreviewRunSessionPort;
  // The display-locale order (the same preference the catalog service holds;
  // the root passes one value to both).
  readonly localePreference?: readonly string[];
}

// The one main button (09 §6.5): exactly one meaning at a time. `enabled`
// false carries its reason — a disabled action states why (11 §7); the
// purchase is never triggered from the preview (NAV6, D06). G06.05 (issue
// #280, AC1): the label, reason and detail are verbatim codes — the words
// live in previewStrings per locale, the runMapReason idiom.
export type PreviewButtonAction = 'download' | 'start';
export type PreviewReason =
  | 'preview#purchase-required'
  | 'preview#storage-unknown'
  | 'preview#verify-unavailable'
  | 'preview#download-unavailable'
  | 'preview#not-published';
export type PreviewDetail =
  | { readonly kind: 'damaged' }
  | { readonly kind: 'incomplete' }
  | { readonly kind: 'missing-files'; readonly count: number }
  | { readonly kind: 'stale' };

export interface PreviewButton {
  readonly action: PreviewButtonAction | null;
  readonly enabled: boolean;
  readonly label: PreviewButtonAction;
  readonly reason: PreviewReason | null;
  readonly detail: PreviewDetail | null;
}

export interface PreviewButtonInput {
  readonly access: 'free' | 'paid' | 'mixed';
  // The paid-access fact: free_base routes and offer-free guides grant the
  // base layer publicly; a paid route starts only with an entitlement, and
  // the MVP root has no entitlement source yet (G08 wires it) — false keeps
  // the paid preview honest: Start disabled with the purchase reason.
  readonly granted: boolean;
  readonly layer: PreviewLayerFacts | null;
  readonly verify: Readiness | null;
  readonly canDownload: boolean;
  // G21.21 (ADR G21.20 §3.2, owner edit 2): the selected cross-locale audio
  // layer's facts — Start waits for its download the same way the text layer
  // waits. null = no cross-locale selection (the monolingual or text-only
  // default), so the button reads the text layer alone.
  readonly audioLayer?: PreviewLayerFacts | null;
  readonly audioVerify?: Readiness | null;
}

// The pure Download/Start derivation (the Proof target: reverting this
// derivation — e.g. an always-Start table — fails the meaning tests).
export function derivePreviewButton(input: PreviewButtonInput): PreviewButton {
  // AC2 (NAV6, D06): the paid preview does not start and buys nothing — the
  // button is disabled with its reason shown.
  if (input.access === 'paid' && !input.granted) {
    return {
      action: 'start',
      enabled: false,
      label: 'start',
      reason: 'preview#purchase-required',
      detail: null,
    };
  }
  // No inventory port — no disk truth: fail closed, never a fictional state.
  if (!input.layer) {
    return {
      action: 'start',
      enabled: false,
      label: 'start',
      reason: 'preview#storage-unknown',
      detail: null,
    };
  }
  if (input.layer.state === 'ready') {
    // G21.21: the selected audio layer joins the gate before Start — an
    // unready cross-locale selection keeps the button on Download (owner
    // edit 2: the download is the wait, never a silent substitution).
    if (input.audioLayer && input.audioLayer.state !== 'ready') {
      return {
        action: 'download',
        enabled: input.canDownload,
        label: 'download',
        reason: input.canDownload ? null : 'preview#download-unavailable',
        detail: input.audioLayer.state === 'partial' ? { kind: 'incomplete' } : null,
      };
    }
    if (input.audioLayer && input.audioVerify && input.audioVerify.status === 'needs-recovery') {
      return {
        action: 'download',
        enabled: input.canDownload,
        label: 'download',
        reason: input.canDownload ? null : 'preview#download-unavailable',
        detail: { kind: 'damaged' },
      };
    }
    if (!input.verify) {
      return {
        action: 'start',
        enabled: false,
        label: 'start',
        reason: 'preview#verify-unavailable',
        detail: null,
      };
    }
    if (input.verify.status === 'ready') {
      return { action: 'start', enabled: true, label: 'start', reason: null, detail: null };
    }
    if (input.verify.status === 'access-locked') {
      return {
        action: 'start',
        enabled: false,
        label: 'start',
        reason: 'preview#purchase-required',
        detail: null,
      };
    }
    // incomplete | needs-recovery: a verify failure leaves Start unavailable
    // with the reason shown (AC5, 11 §7); Download stays the repair path —
    // the activation re-fetches the lock-declared files it missed.
    return {
      action: 'download',
      enabled: input.canDownload,
      label: 'download',
      reason: input.canDownload ? null : 'preview#download-unavailable',
      detail:
        input.verify.status === 'needs-recovery' ? { kind: 'damaged' } : { kind: 'incomplete' },
    };
  }
  // not_downloaded | partial | stale — the package is not fully on disk.
  const detail: PreviewDetail | null =
    input.layer.state === 'partial'
      ? input.layer.missingCount !== null
        ? { kind: 'missing-files', count: input.layer.missingCount }
        : { kind: 'incomplete' }
      : input.layer.state === 'stale'
        ? { kind: 'stale' }
        : null;
  return {
    action: 'download',
    enabled: input.canDownload,
    label: 'download',
    reason: input.canDownload ? null : 'preview#download-unavailable',
    detail,
  };
}

export interface PreviewControllerState {
  readonly surface:
    | { readonly kind: 'loading' }
    | { readonly kind: 'ready'; readonly preview: GuidePreview; readonly degraded: string | null }
    | { readonly kind: 'unavailable'; readonly reason: string };
  readonly source: SourceSurface | null;
  readonly button: PreviewButton;
  // G21.21 (ADR G21.20 §3.2, owner edit 1): the selected audio locale of this
  // walk — the default resolves per the owner's rule (the text locale when
  // its audio exists, else English), the chips re-resolve it explicitly.
  // null = the text-only default (no audio anywhere). The handover carries
  // it to the run surface through the route params.
  readonly audioChoice: string | null;
  // The §4.1 dialog of NAV8: the live walk's title and the candidate's.
  readonly confirm: { readonly liveTitle: string; readonly candidateTitle: string } | null;
  readonly busy: boolean;
  // G06.05 (issue #280, AC4): the named download failure — the banner's
  // reason line, its muted detail and whether the honest manual exit is the
  // storage surface (insufficient-space). A cancelled activation is not a
  // failure — nothing is set.
  readonly downloadError: string | null;
  readonly downloadDetail: string | null;
  readonly downloadStorageExit: boolean;
  refresh(): Promise<void>;
  recordSource(source: string | null): void;
  selectAudio(locale: string): void;
  download(): Promise<void>;
  start(): Promise<'handover' | 'confirm' | 'blocked'>;
  confirmHandover(): void;
  cancelConfirm(): void;
}

// The preview's words, per the display locale (the runMapStrings idiom: the
// codes above are the contract, these are the words; an unknown locale
// falls back to Belarusian, the app's first preference).
export interface PreviewStrings {
  readonly label: Record<PreviewButtonAction, string>;
  readonly reason: Record<PreviewReason, string>;
  readonly detail: (detail: PreviewDetail) => string;
  readonly downloadFailed: string;
  readonly storageFullDetail: (mb: number) => string;
  readonly storageExit: string;
  readonly retry: string;
}

const PREVIEW_STRINGS = PREVIEW_STRINGS_DATA;

export function previewStrings(locale: string): PreviewStrings {
  return locale === 'sv' ? PREVIEW_STRINGS.sv : locale === 'cs' ? PREVIEW_STRINGS.cs : locale === 'es' ? PREVIEW_STRINGS.es : locale === 'fr' ? PREVIEW_STRINGS.fr : locale === 'de' ? PREVIEW_STRINGS.de : locale === 'en' ? PREVIEW_STRINGS.en : locale === 'uk' ? PREVIEW_STRINGS.uk : PREVIEW_STRINGS.be;
}

// The refusal's rendered word: the known map, else the raw reason itself
// (the runMapReason idiom — an unknown diagnostic shows as-is, honest).
export function previewReasonText(reason: string, strings: PreviewStrings): string {
  return strings.reason[reason as PreviewReason] ?? reason;
}

// The base layer locale the button's facts ask about: the first preferred
// locale the guide publishes text for, else the first published one, else
// the first preference (the layer state honestly answers not_downloaded for
// an unpublished locale — no fiction either way).
function layerLocale(preview: GuidePreview, preference: readonly string[]): string {
  for (const locale of preference) {
    if (preview.textLocales.includes(locale)) return locale;
  }
  return preview.textLocales[0] ?? preference[0];
}

// The MVP paid-access fact (see PreviewButtonInput.granted): the base layer
// of a free_base route is public (09 §5: `tier: base` for `free_base` needs
// no grant); an offer-free guide with no route document grants nothing beyond
// its `free` access; a paid route waits for the G08 entitlement source.
function grantedFor(preview: GuidePreview): boolean {
  if (preview.routeAccess === 'free_base') return true;
  if (preview.routeAccess === 'paid') return false;
  return preview.access === 'free';
}

export function createPreviewController(
  ports: PreviewPorts,
  routeId: string,
): ControllerStore<PreviewControllerState> {
  const preference = ports.localePreference ?? ['be', 'en'];
  const strings = previewStrings(preference[0] ?? 'be');
  let seq = 0;
  let previous: GuidePreview | null = null;
  // G21.21: the audio choice persists across refreshes; the default is
  // resolved when the choice is absent or the facts no longer name it.
  let audioChoice: string | null = null;
  // The owner's default rule (ADR G21.20, owner edit 1): the text locale
  // when the guide publishes its audio, else English, else no audio.
  const defaultAudioChoice = (preview: GuidePreview): string | null => {
    const text = layerLocale(preview, preference);
    if (preview.audioLocales.includes(text)) return text;
    if (preview.audioLocales.includes('en')) return 'en';
    return null;
  };
  const store = createControllerStore<PreviewControllerState>((set, get) => {
    // The facts → button derivation, the only place the button is written.
    async function deriveButton(preview: GuidePreview): Promise<PreviewButton> {
      const locale = layerLocale(preview, preference);
      const layer = ports.inventory
        ? await ports.inventory.layerState({ routeId, version: preview.version, locale, tier: 'base' })
        : null;
      const verify =
        layer && layer.state === 'ready' && ports.evaluate
          ? await ports.evaluate.evaluate({ routeId, version: preview.version, locale, tier: 'base' })
          : null;
      // The cross-locale audio layer joins the gate (G21.21): its facts and
      // verify come from the same ports, keyed by the chosen locale.
      const choice = audioChoice ?? defaultAudioChoice(preview);
      const audioLayer =
        choice !== null && choice !== locale && ports.inventory
          ? await ports.inventory.layerState({ routeId, version: preview.version, locale: choice, tier: 'base' })
          : null;
      const audioVerify =
        audioLayer && audioLayer.state === 'ready' && ports.evaluate
          ? await ports.evaluate.evaluate({ routeId, version: preview.version, locale: choice!, tier: 'base' })
          : null;
      return derivePreviewButton({
        access: preview.access,
        granted: grantedFor(preview),
        layer,
        verify,
        canDownload: ports.download !== undefined,
        audioLayer,
        audioVerify,
      });
    }
    // The named download failure (R6): busy releases and the thrown
    // diagnostic survives as the muted detail. Both thrown paths share it —
    // the activation channel and the post-activation facts read.
    function failDownload(error: unknown): void {
      set({
        busy: false,
        downloadError: strings.downloadFailed,
        downloadDetail: error instanceof Error ? error.message : String(error),
      });
    }
    return {
      surface: { kind: 'loading' },
      source: null,
      audioChoice: null,
      button: {
        action: null,
        enabled: false,
        label: 'start',
        reason: 'preview#storage-unknown',
        detail: null,
      },
      confirm: null,
      busy: false,
      downloadError: null,
      downloadDetail: null,
      downloadStorageExit: false,
      refresh: async () => {
        const run = ++seq;
        try {
          const next: PreviewLoadState = await ports.service.loadPreview(routeId, previous);
          if (run !== seq) return;
          if (next.kind === 'ready') {
            previous = next.preview;
            // The audio choice re-resolves when absent or no longer offered
            // (a newer catalog may stop publishing the chosen audio).
            if (audioChoice === null || !next.preview.audioLocales.includes(audioChoice)) {
              audioChoice = defaultAudioChoice(next.preview);
            }
            const button = await deriveButton(next.preview);
            if (run !== seq) return;
            set({
              surface: { kind: 'ready', preview: next.preview, degraded: next.degraded },
              button,
              audioChoice,
            });
            return;
          }
          if (next.kind === 'not-published') {
            set({
              surface: { kind: 'unavailable', reason: 'preview#not-published' },
              button: get().button,
            });
            return;
          }
          set({ surface: { kind: 'unavailable', reason: next.reason }, button: get().button });
        } catch (error) {
          // R6: a failed catalog or facts read still ends the operation —
          // the terminal diagnostic surface, never an eternal loading; a
          // stale failure does not overwrite a newer run's result.
          if (run !== seq) return;
          set({
            surface: {
              kind: 'unavailable',
              reason: error instanceof Error ? error.message : String(error),
            },
            button: get().button,
          });
        }
      },
      recordSource: (source) => {
        // Idempotent: the screen's effect may re-run with the same param —
        // an unchanged source writes nothing (a vanilla set always notifies
        // subscribers, and a notify-per-render loop is exactly what the
        // guard prevents).
        const next = asSourceSurface(source);
        if (get().source !== next) set({ source: next });
      },
      // G21.21: an explicit chip choice — only an audio locale the offer
      // publishes is accepted; anything else is a caller defect and leaves
      // the state untouched (no unvalidated echo).
      selectAudio: (locale) => {
        const state = get();
        if (state.surface.kind !== 'ready') return;
        if (!state.surface.preview.audioLocales.includes(locale)) return;
        if (audioChoice === locale) return;
        audioChoice = locale;
        const preview = state.surface.preview;
        void (async () => {
          try {
            const button = await deriveButton(preview);
            set({ audioChoice: locale, button });
          } catch {
            // The facts read failed: the choice stands, the button keeps its
            // last facts-based meaning — the next refresh re-derives it.
            set({ audioChoice: locale });
          }
        })();
      },
      download: async () => {
        const state = get();
        if (
          !ports.download ||
          state.busy ||
          state.surface.kind !== 'ready' ||
          state.button.action !== 'download' ||
          !state.button.enabled
        ) {
          return;
        }
        const preview = state.surface.preview;
        set({ busy: true, downloadError: null, downloadDetail: null, downloadStorageExit: false });
        const textLocale = layerLocale(preview, preference);
        // G21.21: the selected cross-locale audio layer joins the same
        // download — both layers must complete before the button flips.
        const audioLocale = audioChoice !== null && audioChoice !== textLocale ? audioChoice : null;
        const targets: Array<{ locale: string }> = audioLocale
          ? [{ locale: textLocale }, { locale: audioLocale }]
          : [{ locale: textLocale }];
        let result: ActivationResult | null = null;
        try {
          for (const target of targets) {
            result = await ports.download.activate({
              routeId,
              version: preview.version,
              locale: target.locale,
              tier: 'base',
            });
            if (result.status !== 'complete') break;
          }
        } catch (error) {
          failDownload(error);
          return;
        }
        if (result === null) {
          // Unreachable: targets never runs empty, but the honest guard
          // keeps the busy state from wedging on a caller defect.
          set({ busy: false });
          return;
        }
        // G06.05 (issue #280, AC4): a non-complete activation is a named
        // failure, not a silent button flip — insufficient-space carries the
        // storage exit, a cancelled run is not a failure at all. The button's
        // own flip still comes from the refreshed inventory facts, never
        // from the result (the Proof).
        if (result.status !== 'complete') {
          if (result.status === 'cancelled') {
            set({ busy: false });
            return;
          }
          set({
            busy: false,
            downloadError: strings.downloadFailed,
            downloadDetail:
              result.status === 'insufficient-space'
                ? strings.storageFullDetail(Math.max(1, Math.round(result.needed / 1048576)))
                : result.status === 'hash-mismatch'
                  ? strings.detail({ kind: 'damaged' })
                  : null,
            downloadStorageExit: result.status === 'insufficient-space',
          });
          return;
        }
        // R6: a complete activation result says nothing about readiness —
        // the refreshed facts read may still fail. Busy releases with the
        // visible diagnostic; the button keeps its facts-based meaning (the
        // retry re-derives it), Start never follows the activation result.
        let button: PreviewButton;
        try {
          button = await deriveButton(preview);
        } catch (error) {
          failDownload(error);
          return;
        }
        set({ busy: false, button });
      },
      start: async () => {
        const state = get();
        if (state.surface.kind !== 'ready' || state.busy) return 'blocked';
        if (state.button.action !== 'start' || !state.button.enabled) return 'blocked';
        const live = ports.runSession ? ports.runSession.liveSession() : null;
        // §4.1 (NAV8): another guide with an active or paused session — the
        // single confirm dialog; «Скасаваць» returns to the preview without
        // any session change. The same route's live session is this walk's
        // own entry: the handover changes nothing before the Run surface.
        if (live && live.routeId !== routeId) {
          set({ confirm: { liveTitle: live.title, candidateTitle: state.surface.preview.title } });
          return 'confirm';
        }
        return 'handover';
      },
      confirmHandover: () => set({ confirm: null }),
      cancelConfirm: () => set({ confirm: null }),
    };
  });
  // The boot load starts at creation, like the catalog controller's (09 §4:
  // the refresh runs at every start of the surface).
  void store.getState().refresh();
  return store;
}

export type PreviewControllerStore = ControllerStore<PreviewControllerState>;

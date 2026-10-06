// G06.04 (issue #63) — the KUDY surface (the display name since issue #426;
// the route, controller and contract quotes below keep the my- identifiers):
// the app's session history from the history controller — the live walk
// (active/paused) beside the finished previous runs (11 §16.2, 03: «My KUDY
// захоўвае лакальную гісторыю сесій»). The rows render the durable zone's
// own facts — state,
// dates, heard count — plus the guide's catalog title when the catalog
// names the route (UX 05, issue #351); without it the row falls back to the
// raw id, and no title is ever invented. Without the history member (the
// device db adapter is still to land) it renders its honest unavailable
// state. The read re-runs on focus: a walk started elsewhere is on the list
// when the surface returns.
import { useCallback } from "react";
import { useFocusEffect, useRouter } from "expo-router";
// G22.06 (issue #611): the history is a FlatList — only the visible window of
// the completed rows mounts, never the whole loaded history at once.
import { FlatList, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { CatalogSurfaceState } from "../../controllers/catalog/catalogController";
import { useMyKudy } from "../../controllers/myKudyController";
import type { SessionHistorySummary, SessionRow } from "../../services/db/types";
import {
  deliveryOfView,
  feedbackDeliveryWord,
  feedbackStrings,
  useFeedbackState,
  type FeedbackStateView,
  type FeedbackUiState,
} from "../../controllers/useFeedbackController";
import { useStoreState } from "../../controllers/useControllerStore";
// G21.09 (issue #542): the picker derives its options and labels from the
// one locale registry — the registered complete catalogues only.
import {
  COMPLETE_UI_LOCALES,
  isUiLocaleCode,
  uiLocaleNativeName,
  type CompleteUiLocaleCode,
} from "../../contracts/ui-locales";
import { useServices, useUiLocale } from "../_layout";
import { BackButton } from "../../components/back-button";
import { tokens } from "../../components/design-tokens";
import { LoadingIndicator } from "../../components/loading-indicator";
import { PaperSurface } from "../../components/paper-surface";
import { PressableSurface } from "../../components/pressable-surface";
import { ScaledText } from "../../components/scaled-text";
import { uiStrings } from "../../components/ui-strings";

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: tokens.spaceL,
  },
  title: {
    color: tokens.colorInk,
    fontSize: tokens.fontTitleSize,
    fontWeight: tokens.fontWeightStrong,
    marginBottom: tokens.spaceM,
  },
  section: {
    color: tokens.colorMuted,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
    marginTop: tokens.spaceM,
  },
  row: {
    backgroundColor: tokens.colorCard,
    borderColor: tokens.colorLine,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    marginBottom: tokens.spaceS,
    padding: tokens.spaceM,
  },
  rowTitle: {
    color: tokens.colorInk,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
  },
  rowLine: {
    color: tokens.colorMuted,
    fontSize: 12,
    marginTop: 2,
  },
  unavailable: {
    color: tokens.colorMuted,
    fontSize: tokens.fontBaseSize,
  },
  // G06.05 (AC4): the named retry of a failed history read — the manual
  // exit, styled like the catalog's retry.
  retryButton: {
    alignSelf: "flex-start",
    borderColor: tokens.colorAccent,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    marginTop: tokens.spaceS,
    paddingHorizontal: tokens.spaceM,
    paddingVertical: tokens.spaceS,
  },
  retryLabel: {
    color: tokens.colorAccent,
    fontSize: tokens.fontBaseSize,
  },
  // G14.04.d (issue #305): the language row — three self-named chips in one
  // calm line; the selected chip carries the accent border and ink, the
  // others stay muted.
  localeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.spaceS,
    marginTop: tokens.spaceS,
  },
  localeChip: {
    borderColor: tokens.colorLine,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    paddingHorizontal: tokens.spaceM,
    paddingVertical: tokens.spaceS,
  },
  localeChipSelected: {
    borderColor: tokens.colorAccent,
  },
  localeChipLabel: {
    color: tokens.colorMuted,
    fontSize: tokens.fontBaseSize,
  },
  localeChipLabelSelected: {
    color: tokens.colorAccent,
    fontWeight: tokens.fontWeightStrong,
  },
  // G22.06 (issue #611): the FlatList owns the scroll — it fills the surface
  // under the fixed back button.
  list: {
    flex: 1,
  },
});

// The local calendar day of a durable timestamp (UX 05, issue #351): the
// day the walk happened in the user's zone. The earlier deterministic UTC
// day was a conscious decision, changed consciously here together with its
// test — a UTC day can disagree with the day the person experienced.
const localDay = (at: number): string => {
  const date = new Date(at);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export default function My() {
  const services = useServices();
  // G14.04.d (issue #305): the words read the switchable display locale —
  // a switch re-renders them in place, no restart.
  const locale = useUiLocale();
  // The store handle is stable; the state object is not — the focus refresh
  // reads the store, never the state identity (a refresh that re-runs on its
  // own result would loop forever).
  const historyStore = services.history?.controller;
  const controller = useMyKudy(historyStore);
  // UX 05 (issue #351): the catalog's ready projection names the routes —
  // the same subscription idiom as the history store (19 §2.2), one lookup
  // at render time, no second catalog read. The store's state carries the
  // surface beside its refresh bookkeeping; the rows render the surface.
  const catalogState = useStoreState(services.catalog?.controller ?? null);
  const catalog = catalogState?.surface ?? null;
  // G16.03 (issue #74): the own-ratings list rides the same focus refresh —
  // a rating sent or changed elsewhere is on the list when the surface
  // returns.
  const feedbackController = services.feedback?.controller ?? null;
  const feedbackState = useFeedbackState(feedbackController);
  const feedbackWords = feedbackStrings(locale);
  const router = useRouter();
  useFocusEffect(
    useCallback(() => {
      void historyStore?.getState().refresh();
      feedbackController?.getState().refreshItems();
    }, [historyStore, feedbackController]),
  );
  // UX 02 (issue #348): the frame's top inset — the content starts below the
  // status bar and the notch with the native header off (AC4).
  const insets = useSafeAreaInsets();
  // G06.05 (issue #280, AC1): the surface's words come from the shared
  // catalog in the display locale.
  const strings = uiStrings(locale);
  // G22.06 (issue #611): the ready state drives the paged list — the data is
  // the loaded completed summaries, the load-more walks the store's cursor.
  const ready = controller !== null && controller.status === "ready" ? controller : null;
  const guideTitle = (routeId: string): string => catalogGuideTitle(catalog, routeId);
  const loadMore =
    ready !== null && ready.nextCursor !== null && historyStore !== undefined
      ? () => void historyStore.getState().loadMore()
      : undefined;
  return (
    // G06.10.e (issue #405): the calm surface's paper — the shared wrapper
    // layers the canon grain over the unchanged paper token.
    <PaperSurface style={[styles.screen, { paddingTop: insets.top + tokens.spaceL }]} testID="screen-KUDY">
      {/* UX 02 (issue #348): the surface's one back element (AC2), fixed
          above the scrolling history so it stays reachable. */}
      <BackButton label={strings.back} testID="btn-my-back" />
      {/* UX 01 (issue #347) + G22.06 (issue #611): the history list scrolls
          and windows — the FlatList mounts the visible rows of the loaded
          pages, the header carries the title, the language row, the ratings
          and the live walk. */}
      <FlatList
        testID="scroll-my"
        style={styles.list}
        data={ready?.rows ?? NO_ROWS}
        keyExtractor={(row) => row.sessionId}
        renderItem={({ item }) => <HistoryRow summary={item} guideTitle={guideTitle} strings={strings} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.25}
        initialNumToRender={12}
        ListHeaderComponent={
          <>
            <ScaledText style={styles.title}>{strings.myKudy}</ScaledText>
            {/* G14.04.d (issue #305): the language row (uk-release-scope §4 —
                «Мова прапануецца ў My KUDY») — the one UI-locale switch of the
                app. The options carry their own native names from the catalog;
                the chosen one is announced by the selected state, no invented
                word rides the screen. Writing the switch re-renders this and the
                other surfaces' words in place (the run's pinned locale stays the
                walk's own — ADR G01.03 §3.4). */}
            <UiLocaleRow locale={locale} onPick={(code) => services.uiLocale.set(code)} strings={strings} />
            {feedbackController !== null && feedbackState !== null ? (
              // G16.03 (issue #74): the own ratings (20 §7 «пазней у My KUDY») —
              // without the feedback member the section stays out, the honest
              // absence the surfaces render everywhere.
              <OwnRatings
                state={feedbackState}
                catalog={catalog}
                strings={feedbackWords}
                onEdit={(target) =>
                  router.push({
                    pathname: "/feedback",
                    params: { kind: target.kind, id: target.id, version: target.version, locale: target.locale },
                  })
                }
              />
            ) : null}
            {controller === null || controller.status === "unavailable" ? (
              // No member (the db adapter has not landed) and a failed read are
              // the same honest surface: no history is invented either way.
              // G06.05 (AC4): with a store behind the surface the failed read
              // gets its named retry; without a store there is no exit yet —
              // the honest state stays.
              <View testID="my-unavailable" accessibilityLiveRegion="polite">
                <ScaledText style={styles.unavailable}>{strings.historyUnavailable}</ScaledText>
                {controller !== null ? <ScaledText style={styles.rowLine}>{controller.reason}</ScaledText> : null}
                {historyStore ? (
                  <PressableSurface
                    accessibilityRole="button"
                    accessibilityLabel={strings.retry}
                    onPress={() => void historyStore.getState().refresh()}
                    style={styles.retryButton}
                    testID="btn-my-retry"
                  >
                    <ScaledText style={styles.retryLabel}>{strings.retry}</ScaledText>
                  </PressableSurface>
                ) : null}
              </View>
            ) : null}
            {controller !== null && controller.status === "loading" ? (
              <LoadingIndicator text={strings.loading} />
            ) : null}
            {ready !== null ? (
              <>
                <ScaledText style={styles.section} testID="my-live-section">
                  {strings.currentWalk}
                </ScaledText>
                {ready.live !== null ? (
                  <LiveRow row={ready.live} guideTitle={guideTitle} strings={strings} />
                ) : (
                  <ScaledText style={styles.rowLine}>{strings.noCurrentWalk}</ScaledText>
                )}
                <ScaledText style={styles.section} testID="my-history-section">
                  {strings.pastWalks}
                </ScaledText>
              </>
            ) : null}
          </>
        }
        ListFooterComponent={
          ready !== null && (ready.loadingMore || ready.moreError !== null) ? (
            <View>
              {ready.loadingMore ? <LoadingIndicator text={strings.loading} /> : null}
              {ready.moreError !== null ? (
                // A failed load-more keeps the loaded rows and its cursor: the
                // named retry re-reads the same page (G06.05's exit, paged).
                <View testID="my-more-error">
                  <ScaledText style={styles.rowLine}>{ready.moreError}</ScaledText>
                  <PressableSurface
                    accessibilityRole="button"
                    accessibilityLabel={strings.retry}
                    onPress={() => void historyStore?.getState().loadMore()}
                    style={styles.retryButton}
                    testID="btn-my-more-retry"
                  >
                    <ScaledText style={styles.retryLabel}>{strings.retry}</ScaledText>
                  </PressableSurface>
                </View>
              ) : null}
            </View>
          ) : null
        }
        ListEmptyComponent={
          ready !== null ? <ScaledText style={styles.rowLine}>{strings.noPastWalks}</ScaledText> : null
        }
      />
    </PaperSurface>
  );
}

// G21.17 (issue #551): the history row's content-language label — a
// differently localized session stays resumable and labelled (AC3). The
// registry's native name for a known code; an unknown stored code renders
// as-is — the durable row is never rewritten into a guess.
function sessionLanguageLabel(locale: string): string {
  return isUiLocaleCode(locale) ? uiLocaleNativeName(locale) : locale;
}

// The row's language line (G21.17): one spelling for the live and the
// finished rows — a sibling copy is a jscpd clone.
function SessionLocaleLine({ row }: { row: { sessionId: string; locale: string } }) {
  return (
    <ScaledText style={styles.rowLine} testID={`my-session-locale-${row.sessionId}`}>
      {sessionLanguageLabel(row.locale)}
    </ScaledText>
  );
}

// UX 05 (issue #351): the title comes verbatim from the catalog's ready
// projection (the last valid cache of an offline catalog counts); no
// catalog, or a route it does not name — the row falls back to the raw id,
// the one fact the durable zone keeps. Module-level so the own-ratings rows
// share the same lookup (no sibling copy, implementation-rules 3).
function catalogGuideTitle(catalog: CatalogSurfaceState | null, routeId: string): string {
  if (catalog && (catalog.kind === "ready" || catalog.kind === "offline")) {
    const card = catalog.guides.find((guide) => guide.routeId === routeId);
    if (card) return card.title;
  }
  return routeId;
}

// The FlatList's data when the history member is absent or not ready — one
// stable empty array, never a fresh one per render.
const NO_ROWS: SessionHistorySummary[] = [];

// G22.06 (issue #611): the live walk's row — the durable zone's own facts
// (state, day, heard count) plus the catalog title when it names the route.
function LiveRow({
  row,
  guideTitle,
  strings,
}: {
  row: SessionRow;
  guideTitle: (routeId: string) => string;
  strings: ReturnType<typeof uiStrings>;
}) {
  return (
    <View style={styles.row} testID={`my-session-${row.sessionId}`}>
      <ScaledText style={styles.rowTitle}>{guideTitle(row.routeId)}</ScaledText>
      <ScaledText style={styles.rowLine}>
        {strings.liveRowLine(
          strings.stateLabel[row.state] ?? row.state,
          localDay(row.startedAt),
          row.heard.length,
        )}
      </ScaledText>
      <SessionLocaleLine row={row} />
    </View>
  );
}

// G22.06 (issue #611): a completed history row renders the page summary —
// the same facts the summary projection carries, the heard count derived in
// the store, never another full-history read inside the row.
function HistoryRow({
  summary,
  guideTitle,
  strings,
}: {
  summary: SessionHistorySummary;
  guideTitle: (routeId: string) => string;
  strings: ReturnType<typeof uiStrings>;
}) {
  return (
    <View style={styles.row} testID={`my-session-${summary.sessionId}`}>
      <ScaledText style={styles.rowTitle}>{guideTitle(summary.routeId)}</ScaledText>
      <ScaledText style={styles.rowLine}>
        {strings.pastRowLine(
          localDay(summary.startedAt),
          summary.finishedAt === null ? null : localDay(summary.finishedAt),
          summary.heardCount,
        )}
      </ScaledText>
      <SessionLocaleLine row={summary} />
    </View>
  );
}

// G16.03 (issue #74): the own-ratings list — the durable zone's own rows
// with their honest delivery words (feedbackDeliveryWord, the one mapping).
// The row shows the person's latest desired value (a draft edit outranks the
// acknowledged score) and the rated target's own identity facts; edit
// re-opens the form bound to the row's target. The list deletes and
// resolves through the form — one place owns those actions.
function OwnRatings({
  state,
  catalog,
  strings,
  onEdit,
}: {
  state: FeedbackUiState;
  catalog: CatalogSurfaceState | null;
  strings: ReturnType<typeof feedbackStrings>;
  onEdit: (target: FeedbackStateView["target"]) => void;
}) {
  return (
    <View testID="my-ratings">
      <ScaledText style={styles.section} testID="my-ratings-section">
        {strings.mySection}
      </ScaledText>
      {state.items.length === 0 ? (
        <ScaledText style={styles.rowLine} testID="my-ratings-empty">
          {strings.myEmpty}
        </ScaledText>
      ) : (
        state.items.map((item, index) => {
          const desiredScore =
            item.draft !== null && item.draft.op === "put"
              ? item.draft.score
              : item.score;
          return (
            <View key={item.targetKey} style={styles.row} testID={`my-rating-${index}`}>
              <ScaledText style={styles.rowTitle}>
                {item.target.kind === "guide"
                  ? `${strings.guideWord}: ${catalogGuideTitle(catalog, item.target.id)}`
                  : `${strings.placeWord}: ${item.target.id}`}
              </ScaledText>
              <ScaledText style={styles.rowLine}>
                {desiredScore === null ? "—" : strings.ratingOf(desiredScore)} ·{" "}
                {strings.targetLine(item.target.locale, item.target.version)}
              </ScaledText>
              <ScaledText style={styles.rowLine} testID={`my-rating-state-${index}`}>
                {feedbackDeliveryWord(deliveryOfView(item), strings)}
              </ScaledText>
              <PressableSurface
                accessibilityRole="button"
                accessibilityLabel={strings.myEdit}
                onPress={() => onEdit(item.target)}
                style={styles.retryButton}
                testID={`btn-rating-edit-${index}`}
              >
                <ScaledText style={styles.retryLabel}>{strings.myEdit}</ScaledText>
              </PressableSurface>
            </View>
          );
        })
      )}
    </View>
  );
}

// G14.04.d (issue #305): the My KUDY language row — the options render their
// own native names (the same self-name words in every catalog, a language is
// never named through a translation) and the pick writes the ui-locale store.
// The selected option rides accessibilityState, the word stays the label.
function UiLocaleRow({
  locale,
  onPick,
  strings,
}: {
  locale: string;
  onPick: (code: CompleteUiLocaleCode) => void;
  strings: ReturnType<typeof uiStrings>;
}) {
  const codes = COMPLETE_UI_LOCALES;
  return (
    <View testID="my-ui-locale">
      <ScaledText style={styles.section}>{strings.languageLabel}</ScaledText>
      {/* G21.15 (issue #549): the row carries its own testID — the rendered
          suite pins the wrap layout that keeps all eight chips reachable at
          phone width and the scaled font. */}
      <View style={styles.localeRow} testID="my-ui-locale-row">
        {codes.map((code) => (
          <PressableSurface
            key={code}
            accessibilityRole="button"
            accessibilityLabel={uiLocaleNativeName(code)}
            accessibilityState={{ selected: locale === code }}
            onPress={() => onPick(code)}
            style={[styles.localeChip, locale === code ? styles.localeChipSelected : null]}
            testID={`btn-ui-locale-${code}`}
          >
            <ScaledText
              style={[styles.localeChipLabel, locale === code ? styles.localeChipLabelSelected : null]}
            >
              {uiLocaleNativeName(code)}
            </ScaledText>
          </PressableSurface>
        ))}
      </View>
    </View>
  );
}

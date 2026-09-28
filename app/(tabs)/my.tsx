// G06.04 (issue #63) — the My KUDY surface: the app's session history from
// the history controller — the live walk (active/paused) beside the
// finished previous runs (11 §16.2, 03: «My KUDY захоўвае лакальную
// гісторыю сесій»). The rows render the durable zone's own facts — state,
// dates, heard count — plus the guide's catalog title when the catalog
// names the route (UX 05, issue #351); without it the row falls back to the
// raw id, and no title is ever invented. Without the history member (the
// device db adapter is still to land) it renders its honest unavailable
// state. The read re-runs on focus: a walk started elsewhere is on the list
// when the surface returns.
import { useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { CatalogSurfaceState } from "../../controllers/catalog/catalogController";
import { useMyKudy } from "../../controllers/myKudyController";
import type { MyKudyState } from "../../controllers/myKudyController";
import { useStoreState } from "../../controllers/useControllerStore";
import { useServices } from "../_layout";
import { BackButton } from "../../components/back-button";
import { tokens } from "../../components/design-tokens";
import { LoadingIndicator } from "../../components/loading-indicator";

const styles = StyleSheet.create({
  screen: {
    backgroundColor: tokens.colorPaper,
    flex: 1,
    padding: tokens.spaceL,
  },
  title: {
    color: tokens.colorInk,
    fontSize: 18,
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
});

const STATE_LABEL: Record<string, string> = {
  active: "актыўная",
  paused: "прыпыненая",
  finished: "завершаная",
};

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
  useFocusEffect(
    useCallback(() => {
      void historyStore?.getState().refresh();
    }, [historyStore]),
  );
  // UX 02 (issue #348): the frame's top inset — the content starts below the
  // status bar and the notch with the native header off (AC4).
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { paddingTop: insets.top + tokens.spaceL }]} testID="screen-My KUDY">
      {/* UX 02 (issue #348): the surface's one back element (AC2), fixed
          above the scrolling history so it stays reachable. */}
      <BackButton label="← Назад" testID="btn-my-back" />
      {/* UX 01 (issue #347): the history list scrolls — long finished-run
          lists stay reachable beyond the fold. */}
      <ScrollView testID="scroll-my">
        <Text style={styles.title}>My KUDY</Text>
        {controller === null || controller.status === "unavailable" ? (
          // No member (the db adapter has not landed) and a failed read are
          // the same honest surface: no history is invented either way.
          <View testID="my-unavailable">
            <Text style={styles.unavailable}>Гісторыя недаступная</Text>
            {controller !== null ? <Text style={styles.rowLine}>{controller.reason}</Text> : null}
          </View>
        ) : null}
        {controller !== null && controller.status === "loading" ? (
          <LoadingIndicator text="Загрузка…" />
        ) : null}
        {controller !== null && controller.status === "ready" ? (
          <MyKudyRows state={controller} catalog={catalog} />
        ) : null}
      </ScrollView>
    </View>
  );
}

function MyKudyRows({
  state,
  catalog,
}: {
  state: Extract<MyKudyState, { status: "ready" }>;
  catalog: CatalogSurfaceState | null;
}) {
  // UX 05 (issue #351): the title comes verbatim from the catalog's ready
  // projection (the last valid cache of an offline catalog counts); no
  // catalog, or a route it does not name — the row falls back to the raw id,
  // the one fact the durable zone keeps.
  const guideTitle = (routeId: string): string => {
    if (catalog && (catalog.kind === "ready" || catalog.kind === "offline")) {
      const card = catalog.guides.find((guide) => guide.routeId === routeId);
      if (card) return card.title;
    }
    return routeId;
  };
  const live = state.rows.filter((row) => row.state === "active" || row.state === "paused");
  const finished = state.rows.filter((row) => row.state === "finished");
  return (
    <View>
      <Text style={styles.section} testID="my-live-section">
        Бягучая прагулка
      </Text>
      {live.length > 0 ? (
        live.map((row) => (
          <View key={row.sessionId} style={styles.row} testID={`my-session-${row.sessionId}`}>
            <Text style={styles.rowTitle}>{guideTitle(row.routeId)}</Text>
            <Text style={styles.rowLine}>
              {`${STATE_LABEL[row.state] ?? row.state} — з ${localDay(row.startedAt)} — праслышана: ${row.heard.length}`}
            </Text>
          </View>
        ))
      ) : (
        <Text style={styles.rowLine}>Бягучай прагулкі няма</Text>
      )}
      <Text style={styles.section} testID="my-history-section">
        Папярэднія праходы
      </Text>
      {finished.length > 0 ? (
        finished.map((row) => (
          <View key={row.sessionId} style={styles.row} testID={`my-session-${row.sessionId}`}>
            <Text style={styles.rowTitle}>{guideTitle(row.routeId)}</Text>
            <Text style={styles.rowLine}>
              {`${localDay(row.startedAt)} — ${row.finishedAt === null ? "—" : localDay(row.finishedAt)} — праслышана: ${row.heard.length}`}
            </Text>
          </View>
        ))
      ) : (
        <Text style={styles.rowLine}>Папярэдніх праходаў няма</Text>
      )}
    </View>
  );
}

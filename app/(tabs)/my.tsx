// G06.04 (issue #63) — the My KUDY surface: the app's session history from
// the history controller — the live walk (active/paused) beside the
// finished previous runs (11 §16.2, 03: «My KUDY захоўвае лакальную
// гісторыю сесій»). The rows render exactly what the durable zone keeps —
// route id, state, started date, heard count; the surface invents no title
// and no progress. Without the history member (the device db adapter is
// still to land) it renders its honest unavailable state. The read re-runs
// on focus: a walk started elsewhere is on the list when the surface
// returns.
import { useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useMyKudy } from "../../controllers/myKudyController";
import type { MyKudyState } from "../../controllers/myKudyController";
import { useServices } from "../_layout";
import { BackButton } from "../../components/back-button";
import { tokens } from "../../components/design-tokens";

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

// The UTC date of the durable started_at — the row's own fact, printed
// deterministically (no locale clock of the surface's own).
const startedDay = (startedAt: number): string => new Date(startedAt).toISOString().slice(0, 10);

export default function My() {
  const services = useServices();
  // The store handle is stable; the state object is not — the focus refresh
  // reads the store, never the state identity (a refresh that re-runs on its
  // own result would loop forever).
  const historyStore = services.history?.controller;
  const controller = useMyKudy(historyStore);
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
          <Text style={styles.unavailable}>Загрузка…</Text>
        ) : null}
        {controller !== null && controller.status === "ready" ? <MyKudyRows state={controller} /> : null}
      </ScrollView>
    </View>
  );
}

function MyKudyRows({ state }: { state: Extract<MyKudyState, { status: "ready" }> }) {
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
            <Text style={styles.rowTitle}>{row.routeId}</Text>
            <Text style={styles.rowLine}>
              {`${STATE_LABEL[row.state] ?? row.state} — з ${startedDay(row.startedAt)} — праслышана: ${row.heard.length}`}
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
            <Text style={styles.rowTitle}>{row.routeId}</Text>
            <Text style={styles.rowLine}>
              {`${startedDay(row.startedAt)} — ${row.finishedAt === null ? "—" : startedDay(row.finishedAt)} — праслышана: ${row.heard.length}`}
            </Text>
          </View>
        ))
      ) : (
        <Text style={styles.rowLine}>Папярэдніх праходаў няма</Text>
      )}
    </View>
  );
}

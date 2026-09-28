// G06.01.b (issue #314) — the guide preview surface (RouteDetail, 09 §6.5):
// the published metadata (languages per availability, the recommended route
// time, open vs locked stops — locked rows show name, place, announce and
// lock only, NAV5) and the one main button whose meaning follows the real
// package facts, Download → Start. Every decision comes from the preview
// controller; a disabled action states its reason (11 §7); the purchase is
// never triggered from the preview (NAV6, D06). Back returns to the surface
// the preview was opened from (NAV9) — expo-router's stack pop, with the
// recorded source kept in the controller state.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePreviewController } from "../../controllers/catalog/usePreviewController";
import { BackButton } from "../../components/back-button";
import { tokens } from "../../components/design-tokens";
import { AccessBadge, LocalesLine, StateBanner } from "../../components/guide-card";
import { screenStyles } from "../../components/screen-styles";
import { WalkButton } from "../../components/walk-button";
import { useServices } from "../_layout";

const styles = StyleSheet.create({
  summary: {
    color: tokens.colorMuted,
    fontSize: tokens.fontBaseSize,
    marginBottom: tokens.spaceM,
  },
  fact: {
    color: tokens.colorInk,
    fontSize: tokens.fontBaseSize,
    marginTop: tokens.spaceS,
  },
  stops: {
    marginTop: tokens.spaceM,
  },
  stopRow: {
    backgroundColor: tokens.colorCard,
    borderColor: tokens.colorLine,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    marginBottom: tokens.spaceS,
    padding: tokens.spaceM,
  },
  stopName: {
    color: tokens.colorInk,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
  },
  stopPlace: {
    color: tokens.colorMuted,
    fontSize: 12,
    marginTop: 2,
  },
  stopAnnounce: {
    color: tokens.colorInk,
    fontSize: tokens.fontBaseSize,
    marginTop: tokens.spaceS,
  },
  lockBadge: {
    alignSelf: "flex-start",
    backgroundColor: tokens.colorBadgePaid,
    borderRadius: tokens.radiusPill,
    marginTop: tokens.spaceS,
    overflow: "hidden",
    paddingHorizontal: tokens.spaceS,
    paddingVertical: 2,
  },
  lockBadgeText: {
    color: tokens.colorInk,
    fontSize: 12,
  },
  mainButton: {
    alignItems: "center",
    backgroundColor: tokens.colorAccent,
    borderRadius: tokens.radiusBase,
    marginTop: tokens.spaceM,
    padding: tokens.spaceM,
  },
  mainButtonDisabled: {
    opacity: 0.5,
  },
  mainButtonLabel: {
    color: tokens.colorAccentInk,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
  },
  buttonReason: {
    color: tokens.colorInk,
    fontSize: tokens.fontBaseSize,
    marginTop: tokens.spaceS,
  },
  buttonDetail: {
    color: tokens.colorMuted,
    fontSize: 12,
    marginTop: 2,
  },
  unavailable: {
    color: tokens.colorMuted,
    fontSize: tokens.fontBaseSize,
  },
  confirmOverlay: {
    backgroundColor: "rgba(34, 38, 43, 0.4)",
    flex: 1,
    justifyContent: "center",
    padding: tokens.spaceL,
    ...StyleSheet.absoluteFillObject,
  },
  confirmCard: {
    backgroundColor: tokens.colorCard,
    borderColor: tokens.colorLine,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    padding: tokens.spaceL,
  },
  confirmText: {
    color: tokens.colorInk,
    fontSize: tokens.fontBaseSize,
    marginBottom: tokens.spaceM,
  },
  confirmButton: {
    alignItems: "center",
    backgroundColor: tokens.colorAccent,
    borderRadius: tokens.radiusBase,
    marginBottom: tokens.spaceS,
    padding: tokens.spaceM,
  },
  confirmButtonText: {
    color: tokens.colorAccentInk,
    fontSize: tokens.fontBaseSize,
  },
});

function formatDuration(
  estimated: { min_minutes: number; max_minutes: number } | null,
  durationMin: number | null,
): string | null {
  if (estimated) return `Час: ад ${estimated.min_minutes} да ${estimated.max_minutes} хв`;
  if (durationMin !== null) return `Час: ${durationMin} хв`;
  return null;
}

export default function RoutePreview() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const router = useRouter();
  const services = useServices();
  const routeId = typeof id === "string" && id.length > 0 ? id : "";
  const controller = usePreviewController(routeId ? services.preview : undefined, routeId);
  useEffect(() => {
    // NAV9: the opening records its source surface; an unrecognized value
    // records nothing (no unvalidated echo, 21 §3.2).
    controller?.recordSource(typeof from === "string" ? from : null);
  }, [controller, from]);

  // UX 02 (issue #348): the frame's top inset — the content starts below the
  // status bar and the notch with the native header off (AC4). A hook —
  // before the early returns.
  const insets = useSafeAreaInsets();

  if (!controller) {
    return (
      <View
        style={[screenStyles.screen, { paddingTop: insets.top + tokens.spaceL }]}
        testID="screen-Route preview"
      >
        {/* UX 02 (issue #348): even the unavailable state keeps the frame —
            with the native header off there is no other way back (AC2). */}
        <BackButton label="← Назад" testID="btn-preview-back" />
        <Text style={styles.unavailable}>Каталог недаступны</Text>
      </View>
    );
  }
  // Start hands over to the Run surface (the run controller's G06.02 home):
  // the controller gates the §4.1 dialog; the handover itself is navigation.
  const handleMainButton = async () => {
    if (controller.button.action === "download") {
      await controller.download();
      return;
    }
    const outcome = await controller.start();
    if (outcome === "handover") router.push(`/run/${routeId}`);
  };
  const state = controller;
  return (
    <View style={[screenStyles.screen, { paddingTop: insets.top + tokens.spaceL }]} testID="screen-Route preview">
      {/* UX 02 (issue #348): the back sits in the frame above the scroll —
          reachable while the stops list is scrolled (AC2). */}
      <BackButton label="← Назад" testID="btn-preview-back" />
      {/* UX 01 (issue #347): the surface scrolls — every stop and the main
          button stay reachable beyond the fold; the §4.1 overlay stays above. */}
      <ScrollView testID="scroll-preview">
        <WalkButton walk={services.walk} />
        {state.surface.kind === "loading" ? <Text style={styles.unavailable}>Загрузка…</Text> : null}
        {state.surface.kind === "unavailable" ? (
          <View testID="preview-unavailable">
            <Text style={styles.unavailable}>Прэв'ю часова недаступны</Text>
            <Text style={styles.buttonDetail}>{state.surface.reason}</Text>
          </View>
        ) : null}
        {state.surface.kind === "ready" ? (
          <View>
            <Text style={screenStyles.title}>{state.surface.preview.title}</Text>
            {state.surface.preview.summary ? (
              <Text style={styles.summary}>{state.surface.preview.summary}</Text>
            ) : null}
            <AccessBadge access={state.surface.preview.access} />
            <LocalesLine
              textLocales={state.surface.preview.textLocales}
              audioLocales={state.surface.preview.audioLocales}
              localesKnown={state.surface.preview.localesKnown}
              testID="preview-locales"
            />
            {formatDuration(state.surface.preview.estimatedDuration, state.surface.preview.durationMin) ? (
              <Text style={styles.fact} testID="preview-duration">
                {formatDuration(state.surface.preview.estimatedDuration, state.surface.preview.durationMin)}
              </Text>
            ) : null}
            {state.surface.preview.stops ? (
              <Text style={styles.fact} testID="preview-counts">
                {`Кропкі: ${state.surface.preview.stops.length}`}
              </Text>
            ) : null}
            {state.surface.preview.baseSizeBytes !== null ? (
              <Text style={styles.fact} testID="preview-size">
                {`Памер: ${Math.max(1, Math.round(state.surface.preview.baseSizeBytes / 1048576))} МБ`}
              </Text>
            ) : null}
            {state.surface.preview.access === "paid" && state.surface.preview.freeStopCount !== null ? (
              <Text style={styles.fact} testID="preview-free-stop-count">
                {`Кропак бясплатна: ${state.surface.preview.freeStopCount}`}
              </Text>
            ) : null}
            {state.surface.degraded ? (
              <StateBanner
                tone="notice"
                reason="Частка звестак часова недаступная"
                detail={state.surface.degraded}
                testID="preview-banner"
              />
            ) : null}
            {state.downloadError ? (
              <StateBanner tone="error" reason="Збой загрузкі" detail={state.downloadError} testID="download-error" />
            ) : null}
            {state.surface.preview.stops ? (
              <View style={styles.stops} testID="preview-stops">
                {state.surface.preview.stops.map((stop) => (
                  <View key={stop.stopId} style={styles.stopRow} testID={`stop-${stop.stopId}`}>
                    <Text style={styles.stopName}>{stop.name ?? `Кропка ${stop.position + 1}`}</Text>
                    <Text style={styles.stopPlace}>{stop.placeId}</Text>
                    {stop.announce ? <Text style={styles.stopAnnounce}>{stop.announce}</Text> : null}
                    {stop.locked ? (
                      <View style={styles.lockBadge} testID={`stop-locked-${stop.stopId}`}>
                        <Text style={styles.lockBadgeText}>🔒</Text>
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}
            <Pressable
              onPress={() => void handleMainButton()}
              disabled={!state.button.enabled || state.busy}
              style={[styles.mainButton, (!state.button.enabled || state.busy) && styles.mainButtonDisabled]}
              testID={state.button.action === "download" ? "btn-download" : "btn-start"}
            >
              <Text style={styles.mainButtonLabel}>{state.button.label}</Text>
            </Pressable>
            {state.button.reason ? (
              <Text style={styles.buttonReason} testID="button-reason">
                {state.button.reason}
              </Text>
            ) : null}
            {state.button.detail ? (
              <Text style={styles.buttonDetail} testID="button-detail">
                {state.button.detail}
              </Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      {state.confirm ? (
        <View style={styles.confirmOverlay} testID="confirm-dialog">
          <View style={styles.confirmCard}>
            <Text style={styles.confirmText}>
              {`Завяршыць «${state.confirm.liveTitle}» і пачаць «${state.confirm.candidateTitle}»?`}
            </Text>
            <Pressable
              onPress={() => {
                // The confirmed §4.1 switch (NAV8): the flag rides the route
                // params — the run surface starts through the switch-guide
                // transaction (the live walk finishes in the same commit the
                // new row inserts), the dialog state itself carries no write.
                state.confirmHandover();
                router.push(`/run/${routeId}?confirmedSwitch=1`);
              }}
              style={styles.confirmButton}
              testID="btn-confirm-start"
            >
              <Text style={styles.confirmButtonText}>Завершыць і пачаць</Text>
            </Pressable>
            <Pressable
              onPress={() => state.cancelConfirm()}
              style={[styles.confirmButton, styles.mainButtonDisabled]}
              testID="btn-confirm-cancel"
            >
              <Text style={styles.confirmButtonText}>Скасаваць</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

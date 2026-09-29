// G06.02 (issue #278) + G06.03 (issue #279) — the Run surface (11 §6): the
// route's points on an honest schematic map — no tile engine exists until
// the map decision (ADR G00.02) is accepted — with the five marker states
// computed by the engine (ADR G01.01 §4.5), the POI points visually distinct
// from the audio points, and the ODbL attribution visible and tappable.
// G06.03 adds the history panel (11 §2): one bottom sheet over the map with
// three fixed heights — the Peek player bar (the session's anchor), the
// Half preview and the Full story with the transcript slot. The panel's
// position and the inspected card are the run controller's UI state: a
// marker tap opens the card (11 §2), ✕ and Back dismiss one position down
// and are identical (AC1), the transcript belongs to `inspected` while the
// bar and its progress track belong to the audible story (AC2), and no
// panel change dispatches to the audio service (AC3).
// The walk itself lives in the run controller the composition root built —
// this surface owns no GPS, no player and no engine (AC4).
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { runMapView, runMapReason, runMapStrings } from "../../controllers/run/runMap";
import { useRunState, useRunSurface } from "../../controllers/run/runSurfaceController";
import { BackButton } from "../../components/back-button";
import { PressableSurface } from "../../components/pressable-surface";
import { tokens } from "../../components/design-tokens";
import { LoadingIndicator } from "../../components/loading-indicator";
import {
  ModalDialog,
  ModalDialogAccept,
  ModalDialogCancel,
} from "../../components/modal-dialog";
import { ScaledText } from "../../components/scaled-text";
import { useServices } from "../_layout";

const OSM_ATTRIBUTION_URL = "https://www.openstreetmap.org/copyright";

// UX 04 (issue #350): the marker fills are the canon's own marker tokens
// (color.marker.*), each ≥3:1 against the canon map background (WCAG
// 1.4.11) — a status is a word first, the color is the second channel
// (G06.06); test/run-map-contrast.test.mjs guards the configuration.
const STATUS_COLOR: Record<string, string> = {
  playing: tokens.colorMarkerPlaying,
  played: tokens.colorMarkerPlayed,
  available: tokens.colorMarkerAvailable,
  pending: tokens.colorMarkerPending,
  locked: tokens.colorMarkerLocked,
};

const styles = StyleSheet.create({
  screen: {
    backgroundColor: tokens.colorPaper,
    flex: 1,
    padding: tokens.spaceL,
  },
  centered: {
    color: tokens.colorMuted,
    fontSize: tokens.fontBaseSize,
    marginTop: tokens.spaceL,
  },
  reason: {
    color: tokens.colorInk,
    fontSize: tokens.fontBaseSize,
    marginTop: tokens.spaceS,
  },
  map: {
    // UX 04 (issue #350): the canon map background (color.map) — the marker
    // tokens' contrast pairs are declared against it, not against card white.
    backgroundColor: tokens.colorMap,
    borderColor: tokens.colorLine,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    flex: 1,
    overflow: "hidden",
  },
  note: {
    color: tokens.colorMuted,
    fontSize: 12,
    marginTop: tokens.spaceS,
  },
  marker: {
    alignItems: "center",
    // UX 04 (issue #350, AC4): the marker's touch target keeps the 44dp
    // floor whatever the label wraps into — the dot plus label normally
    // exceeds it already.
    minHeight: 44,
    position: "absolute",
    width: 120,
  },
  dot: {
    // UX 04 (issue #350): the canon marker — size.marker diameter, state
    // fill, white 2px outline, a soft shadow; the fill carries the ≥3:1
    // figure contrast, the outline is separation only (visual-language.md
    // «Маркеры мапы»).
    borderColor: tokens.colorAccentInk,
    borderRadius: 999,
    borderWidth: 2,
    elevation: 2,
    height: tokens.markerSize,
    shadowColor: tokens.colorInk,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    width: tokens.markerSize,
  },
  poi: {
    backgroundColor: tokens.colorBadgeMixed,
    borderColor: tokens.colorMuted,
    borderRadius: 4,
    borderWidth: 1,
    height: 14,
    width: 14,
  },
  markerLabel: {
    color: tokens.colorInk,
    // UX 04 (issue #350, AC5): the readable 12dp floor for map labels.
    fontSize: 12,
    marginTop: 2,
    textAlign: "center",
  },
  poiLabel: {
    color: tokens.colorMuted,
    // UX 04 (issue #350, AC5): the readable 12dp floor for map labels.
    fontSize: 12,
    marginTop: 2,
    textAlign: "center",
  },
  pausedBanner: {
    backgroundColor: tokens.colorNoticeBg,
    borderColor: tokens.colorNoticeBorder,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    marginBottom: tokens.spaceS,
    padding: tokens.spaceM,
  },
  pausedText: {
    color: tokens.colorInk,
    fontSize: tokens.fontBaseSize,
  },
  // G06.05 (AC4/AC5): the degradation banners share the paused banner's
  // notice box; their hint lines render muted below the primary word.
  bannerDetailText: {
    color: tokens.colorMuted,
    fontSize: tokens.fontBaseSize,
    marginTop: tokens.spaceS,
  },
  // The card's story-layer switch (AC3): the two tabs read as one group.
  layerRow: {
    flexDirection: "row",
    gap: tokens.spaceS,
    marginTop: tokens.spaceS,
  },
  layerTab: {
    alignItems: "center",
    borderColor: tokens.colorLine,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    flex: 1,
    paddingVertical: tokens.spaceS,
    paddingHorizontal: tokens.spaceM,
  },
  layerTabActive: {
    borderColor: tokens.colorAccent,
  },
  layerLabel: {
    color: tokens.colorAccent,
    fontSize: tokens.fontBaseSize,
  },
  // The session menu (G06.04): the walk's pause and finish beside each
  // other, one visual row under the paused banner.
  sessionActions: {
    flexDirection: "row",
    gap: tokens.spaceS,
    marginBottom: tokens.spaceS,
  },
  sessionButton: {
    alignItems: "center",
    borderColor: tokens.colorAccent,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    padding: tokens.spaceS,
  },
  sessionLabel: {
    color: tokens.colorAccent,
    fontSize: tokens.fontBaseSize,
  },
  resumeButton: {
    alignItems: "center",
    backgroundColor: tokens.colorAccent,
    borderRadius: tokens.radiusBase,
    marginTop: tokens.spaceS,
    padding: tokens.spaceM,
  },
  resumeLabel: {
    color: tokens.colorAccentInk,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
  },
  preview: {
    backgroundColor: tokens.colorCard,
    borderColor: tokens.colorLine,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    marginBottom: tokens.spaceS,
    padding: tokens.spaceM,
  },
  previewName: {
    color: tokens.colorInk,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
  },
  previewStatus: {
    color: tokens.colorMuted,
    fontSize: 12,
    marginTop: 2,
  },
  closeButton: {
    alignSelf: "flex-start",
    marginTop: tokens.spaceS,
  },
  closeLabel: {
    color: tokens.colorAccent,
    fontSize: tokens.fontBaseSize,
  },
  attribution: {
    alignSelf: "flex-start",
    marginTop: tokens.spaceS,
  },
  attributionText: {
    color: tokens.colorMuted,
    // UX 04 (issue #350, AC5): the readable 12dp floor applies to the
    // attribution line as well.
    fontSize: 12,
  },
  // The history panel (G06.03): one sheet over the map, three heights.
  panel: {
    backgroundColor: tokens.colorCard,
    borderColor: tokens.colorLine,
    borderTopLeftRadius: tokens.radiusBase,
    borderTopRightRadius: tokens.radiusBase,
    borderTopWidth: 1,
    bottom: 0,
    left: 0,
    padding: tokens.spaceM,
    position: "absolute",
    right: 0,
  },
  panelHalf: {
    height: "45%",
  },
  panelFull: {
    height: "92%",
  },
  panelBar: {
    backgroundColor: tokens.colorCard,
    borderColor: tokens.colorLine,
    borderTopWidth: 1,
    bottom: 0,
    left: 0,
    padding: tokens.spaceM,
    position: "absolute",
    right: 0,
  },
  barTitle: {
    color: tokens.colorInk,
    flexShrink: 1,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
  },
  barRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: tokens.spaceS,
  },
  barControl: {
    borderColor: tokens.colorLine,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    paddingHorizontal: tokens.spaceM,
    paddingVertical: tokens.spaceS,
  },
  barControlLabel: {
    color: tokens.colorAccent,
    fontSize: tokens.fontBaseSize,
  },
  progressTrack: {
    // UX 04 (issue #350, AC2): the canon strip is 6px accent-on-line; the
    // muted 1px boundary lifts the track's identifying edge to ≥3:1 against
    // the bar's card background (WCAG 1.4.11) — the line fill alone was 1.5:1.
    backgroundColor: tokens.colorLine,
    borderColor: tokens.colorMuted,
    borderRadius: 999,
    borderWidth: 1,
    height: 6,
    marginTop: tokens.spaceS,
  },
  progressFill: {
    backgroundColor: tokens.colorAccent,
    height: "100%",
  },
  nowPlayingRow: {
    borderColor: tokens.colorNoticeBorder,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    marginBottom: tokens.spaceS,
    padding: tokens.spaceS,
  },
  nowPlayingText: {
    color: tokens.colorInk,
    fontSize: tokens.fontBaseSize,
  },
  transcriptHeading: {
    color: tokens.colorInk,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
    marginTop: tokens.spaceS,
  },
  transcriptNote: {
    color: tokens.colorMuted,
    fontSize: 12,
    marginTop: 2,
  },
  transcriptBody: {
    color: tokens.colorInk,
    fontSize: tokens.fontBaseSize,
    marginTop: 2,
  },
  readButton: {
    alignItems: "center",
    borderColor: tokens.colorAccent,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    marginTop: tokens.spaceS,
    padding: tokens.spaceS,
  },
  readLabel: {
    color: tokens.colorAccent,
    fontSize: tokens.fontBaseSize,
  },
  // The finish confirmation's words (UX 06, issue #352) — the shell carries
  // the card and the two action styles.
  confirmText: {
    color: tokens.colorInk,
    fontSize: tokens.fontBaseSize,
    marginBottom: tokens.spaceM,
  },
});

export default function Run() {
  const { id, confirmedSwitch } = useLocalSearchParams<{ id: string; confirmedSwitch?: string }>();
  const router = useRouter();
  const services = useServices();
  const routeId = typeof id === "string" ? id : "";
  // The §4.1 handover's confirmed flag (G06.04): «Завяршыць і пачаць» on the
  // preview started this route's surface through the switch-guide
  // transaction. The cached re-entry (NAV7) ignores the flag.
  const surface = useRunSurface(services.run, routeId, confirmedSwitch === "1");
  const ready = surface?.status === "ready" ? surface : null;
  const run = useRunState(ready?.controller ?? null);
  const strings = runMapStrings(ready?.locale ?? "be");

  // UX 02 (issue #348): the frame's top inset — the content starts below the
  // status bar and the notch with the native header off (AC4). A hook —
  // before the early returns.
  const insets = useSafeAreaInsets();
  // UX 06 (issue #352): the destructive finish asks first — the dialog is a
  // surface-side gate (a hook, before the early returns); the controller's
  // end() stays the only session write and runs only on the confirmation.
  const [endConfirm, setEndConfirm] = useState(false);
  // G06.05 (AC3): the card's story-layer switch bookkeeping — the switch
  // belongs to one card, another opened card starts back on the base story.
  const [layerByStop, setLayerByStop] = useState<{ stopId: string | null; layer: "base" | "extended" }>({
    stopId: null,
    layer: "base",
  });

  if (surface === null || surface.status === "unavailable") {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + tokens.spaceL }]} testID="screen-Run">
        <BackButton label={strings.back} testID="btn-run-back" />
        <ScaledText style={styles.centered}>{strings.unavailableTitle}</ScaledText>
        {surface !== null ? (
          <ScaledText style={styles.reason} testID="run-unavailable-reason">
            {runMapReason(surface.reason, strings)}
          </ScaledText>
        ) : null}
      </View>
    );
  }
  if (surface.status === "loading" || run === null) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + tokens.spaceL }]} testID="screen-Run">
        {/* UX 02 (issue #348): the loading state keeps the frame — with the
            native header off there is no other way back (AC2). */}
        <BackButton label={strings.back} testID="btn-run-back" />
        <LoadingIndicator style={styles.centered} text={strings.loading} />
      </View>
    );
  }
  const view = runMapView(run.run, surface.stops, surface.facts, surface.places, [surface.locale, "be", "en"]);
  // The panel's two pointers (11 §3.2): `inspected` — whose card is open —
  // and the audible launch the bar mirrors. Independent by design: the card
  // follows the taps, the bar follows the sound.
  const session = run.run.phase === "Idle" ? null : run.run;
  const playing = session?.playing ?? null;
  const playingGuide = playing && playing.owner === "guide" ? playing : null;
  const playingName = playing
    ? playingGuide
      ? (view.markers.find((marker) => marker.stopId === playingGuide.stopId)?.name ?? playingGuide.storyId)
      : playing.storyId
    : null;
  const inspectedMarker = run.inspected
    ? (view.markers.find((marker) => marker.stopId === run.inspected) ?? null)
    : null;
  // The strip's fill is the audible audio's own line (AC2): read from the
  // audio service's computed state (09 §6.3) — never from the card's data.
  const playback = surface.playback();
  const stripProgress =
    (playback.kind === "playing" || playback.kind === "paused") && playback.durationMs > 0
      ? Math.min(1, Math.max(0, playback.positionMs / playback.durationMs))
      : 0;
  // G06.05 (AC3): the inspected card's transcript — the base story and, when
  // the stop carries one and the pin has the extended tier, the extended
  // story behind the card's own switch. A story without a readable
  // transcript keeps the honest pending note — never invented text.
  const inspectedStop = inspectedMarker
    ? (surface.stops.find((stop) => stop.stopId === inspectedMarker.stopId) ?? null)
    : null;
  const baseStoryId = inspectedStop?.storyBaseId;
  const extendedStoryId = inspectedStop?.storyExtendedId;
  const hasExtended =
    extendedStoryId !== undefined &&
    surface.storiesExtended.some((story) => story.storyId === extendedStoryId);
  const storyLayer = layerByStop.stopId === run.inspected ? layerByStop.layer : "base";
  const activeLayer = hasExtended ? storyLayer : "base";
  const activeStoryId = activeLayer === "extended" ? extendedStoryId : baseStoryId;
  // The engine's own accessibility rule (ADR G01.01 §4.2, core/engine/state):
  // the stop is accessible and the story's tier is available — the manual
  // play button renders only for a story the engine would actually launch,
  // never a silent refusal.
  const storyPlayable = (storyId: string | undefined): boolean => {
    if (session === null || storyId === undefined || inspectedMarker === null) return false;
    const stop = session.stops.find((candidate) => candidate.stopId === inspectedMarker.stopId);
    if (stop === undefined) return false;
    const tier = stop.storyExtendedId === storyId ? "extended" : "base";
    return session.accessibleStopIds.includes(stop.stopId) && session.tierAvailable.includes(tier);
  };
  const inspectedTranscript = (() => {
    if (!inspectedMarker || inspectedMarker.status === "locked") return null;
    if (activeStoryId === undefined) return null;
    const source = activeLayer === "extended" ? surface.storiesExtended : surface.stories;
    return source.find((story) => story.storyId === activeStoryId)?.transcript ?? null;
  })();
  // G06.05 (AC4/AC5): the location service's live status — the honest
  // degradation banners of 11 §7 read it per render.
  const locationStatus = surface.locationStatus();
  // ✕ and Back dismiss identically (AC1, 11 §2 — "адно і тое ж"); from Peek
  // the Back button is the navigation out of Run — it never stops the audio
  // and never changes the session (AC4).
  const backOrDismiss = () => {
    if (run.panel !== "peek") run.dismissPanel();
    else router.back();
  };
  // UX 04 (issue #350, AC3): while the peek bar is up, its absolute
  // positioning covers the screen's bottom flow — the attribution lives
  // inside the bar then, never under it.
  const peekBarOpen = session !== null && session.phase !== "Ended" && run.panel === "peek";
  // UX 04 (issue #350, AC4): the ODbL duty — a real Pressable link, one
  // element rendered either in the flow or as the peek bar's last row.
  const attribution = (
    <PressableSurface
      accessibilityRole="link"
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      onPress={() => {
        // A failed external open has no in-app surface — the failure is
        // deliberately silent, the attribution text stays readable either way.
        void Linking.openURL(OSM_ATTRIBUTION_URL).catch(() => undefined);
      }}
      style={styles.attribution}
      testID="map-attribution"
    >
      <ScaledText style={styles.attributionText}>{strings.attribution}</ScaledText>
    </PressableSurface>
  );
  return (
    <View style={[styles.screen, { paddingTop: insets.top + tokens.spaceL }]} testID="screen-Run">
      {/* UX 02 (issue #348): the one back element; from Peek it is the
          navigation out of Run, from an open card it dismisses the card —
          the controller's backOrDismiss (AC2). */}
      <BackButton label={strings.back} onPress={backOrDismiss} testID="btn-run-back" />
      {/* G06.05 (AC4/AC5): the honest degradation banners of 11 §7 — every
          state names itself, carries its manual exit and is announced (a
          live region), never a modal, never a mascot. */}
      {run.recovery.status === "restored" ? (
        <View style={styles.pausedBanner} testID="run-restored" accessibilityLiveRegion="polite">
          <ScaledText style={styles.pausedText}>{strings.restoredTitle}</ScaledText>
          {run.recovery.unavailableTiers.length > 0 ? (
            <ScaledText style={styles.bannerDetailText}>{strings.tierUnavailable}</ScaledText>
          ) : null}
        </View>
      ) : null}

      {locationStatus.state === "stalled" ? (
        <View style={styles.pausedBanner} testID="run-gps-stalled" accessibilityLiveRegion="polite">
          <ScaledText style={styles.pausedText}>{strings.gpsStalled}</ScaledText>
          <ScaledText style={styles.bannerDetailText}>{strings.gpsStalledDetail}</ScaledText>
        </View>
      ) : null}
      {session !== null &&
      session.phase === "Active" &&
      session.autoplaySuspended &&
      locationStatus.state !== "permission-denied" &&
      locationStatus.state !== "stalled" ? (
        // The suspended automation (11 §2.1: focus loss, story_play_failed,
        // a moment's takeover) — the honest note with the manual path.
        <View style={styles.pausedBanner} testID="run-autoplay-suspended" accessibilityLiveRegion="polite">
          <ScaledText style={styles.pausedText}>{strings.autoplaySuspendedTitle}</ScaledText>
          <ScaledText style={styles.bannerDetailText}>{strings.manualPlayHint}</ScaledText>
        </View>
      ) : null}
      {locationStatus.state === "permission-denied" ? (
        <View style={styles.pausedBanner} testID="run-gps-denied" accessibilityLiveRegion="polite">
          <ScaledText style={styles.pausedText}>{strings.deniedGps}</ScaledText>
          <ScaledText style={styles.bannerDetailText}>{strings.manualPlayHint}</ScaledText>
        </View>
      ) : null}
      {run.run.phase === "Paused" ? (
        <View style={styles.pausedBanner} testID="run-paused" accessibilityLiveRegion="polite">
          <ScaledText style={styles.pausedText}>{strings.pausedTitle}</ScaledText>
          <PressableSurface
            accessibilityRole="button"
            accessibilityLabel={strings.resume}
            onPress={() => run.resumeSession()}
            style={styles.resumeButton}
            testID="btn-run-resume"
          >
            <ScaledText style={styles.resumeLabel}>{strings.resume}</ScaledText>
          </PressableSurface>
        </View>
      ) : null}
      {run.run.phase === "Ended" ? (
        <ScaledText style={styles.centered} testID="run-ended" accessibilityLiveRegion="polite">
          {strings.endedTitle}
        </ScaledText>
      ) : null}
      {session && session.phase !== "Ended" ? (
        // The session menu of 11 §4.2/§4.3 (G06.04): the whole-walk pause
        // (not the audio pause) and the finish — the finish is legal at any
        // moment, even after one story; from Paused the banner's Resume is
        // the way back. Neither touches the audio's own play/pause.
        <View style={styles.sessionActions} testID="run-session-actions">
          {session.phase === "Active" ? (
            <PressableSurface
              accessibilityRole="button"
              accessibilityLabel={strings.pauseWalk}
              onPress={() => run.pauseSession()}
              style={styles.sessionButton}
              testID="btn-run-pause"
            >
              <ScaledText style={styles.sessionLabel}>{strings.pauseWalk}</ScaledText>
            </PressableSurface>
          ) : null}
          {/* UX 06 (issue #352) AC3: the destructive finish asks first —
              the press opens the confirmation, it no longer ends directly. */}
          <PressableSurface
            accessibilityRole="button"
            accessibilityLabel={strings.endWalk}
            onPress={() => setEndConfirm(true)}
            style={styles.sessionButton}
            testID="btn-run-end"
          >
            <ScaledText style={styles.sessionLabel}>{strings.endWalk}</ScaledText>
          </PressableSurface>
        </View>
      ) : null}
      {view.markers.length > 0 ? (
        <View style={styles.map} testID="run-map">
          {view.pois.map((poi) => {
            // UX 05 (issue #351): the label goes through the run strings'
            // kind dictionary — a kind without an entry renders no label,
            // the raw value never shows (nothing invented).
            const poiLabel = strings.poiKind[poi.kind] ?? null;
            return (
              <View
                key={poi.placeId}
                style={[styles.marker, { left: `${poi.nx * 100}%`, top: `${poi.ny * 100}%`, transform: [{ translateX: -60 }, { translateY: -9 }] }]}
                testID={`run-poi-${poi.placeId}`}
              >
                <View style={styles.poi} />
                {poiLabel ? <Text style={styles.poiLabel}>{poiLabel}</Text> : null}
              </View>
            );
          })}
          {view.markers.map((marker) => (
            <Pressable
              key={marker.stopId}
              accessibilityRole="button"
              accessibilityHint={strings.markerHint}
              accessibilityLabel={`${marker.name}, ${strings.status[marker.status]}`}
              onPress={() => run.openCard(marker.stopId)}
              style={[
                styles.marker,
                // UX 04 (issue #350): the dot centers on the point whatever
                // the canon markerSize — the label hangs below it.
                { left: `${marker.nx * 100}%`, top: `${marker.ny * 100}%`, transform: [{ translateX: -60 }, { translateY: -(tokens.markerSize / 2) }] },
              ]}
              testID={`run-marker-${marker.stopId}`}
            >
              <View style={[styles.dot, { backgroundColor: STATUS_COLOR[marker.status] }]} />
              <ScaledText style={styles.markerLabel} testID={`run-status-${marker.stopId}`}>
                {`${marker.name} — ${strings.status[marker.status]}`}
              </ScaledText>
            </Pressable>
          ))}
        </View>
      ) : null}
      <ScaledText style={styles.note}>{strings.schematicNote}</ScaledText>
      {/* UX 04 (issue #350, AC3): the in-flow spot only when the peek bar is
          down — the bar's own copy replaces it while the bar covers the flow. */}
      {peekBarOpen ? null : attribution}
      {peekBarOpen ? (
        // UX 02 (issue #348): the bar's bottom padding keeps its controls
        // above the home-indicator area (AC4).
        <View
          style={[styles.panelBar, { paddingBottom: tokens.spaceM + insets.bottom }]}
          testID="run-panel-bar"
        >
          <View style={styles.barRow}>
            <ScaledText style={styles.barTitle} testID="run-bar-title">
              {playingName ? `${strings.nowPlayingLabel}: ${playingName}` : strings.nothingPlaying}
            </ScaledText>
            {playingGuide ? (
              // The bar's control is the guide launch's only: a moment
              // launch (G07) resumes through its own path, never through
              // this button — the controller's guide-token rebuild must not
              // become a silent no-op behind a visible control.
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={playingGuide.paused ? strings.playAudio : strings.pauseAudio}
                onPress={() => (playingGuide.paused ? run.resumeCurrentAudio() : run.pauseAudio())}
                style={styles.barControl}
                testID="btn-bar-playpause"
              >
                <ScaledText style={styles.barControlLabel}>
                  {playingGuide.paused ? strings.playAudio : strings.pauseAudio}
                </ScaledText>
              </Pressable>
            ) : null}
          </View>
          {playing ? (
            <View style={styles.progressTrack} testID="run-bar-progress">
              <View
                style={[styles.progressFill, { width: `${Math.round(stripProgress * 100)}%` }]}
                testID="run-bar-progress-fill"
              />
            </View>
          ) : null}
          {/* UX 04 (issue #350, AC3): the ODbL attribution rides the bar —
              visible and tappable with the bar up, never covered by it. */}
          {attribution}
        </View>
      ) : null}
      {run.panel !== "peek" ? (
        // UX 02 (issue #348): the sheet's bottom padding keeps its content
        // above the home-indicator area (AC4).
        <View
          style={[
            styles.panel,
            run.panel === "full" ? styles.panelFull : styles.panelHalf,
            { paddingBottom: tokens.spaceM + insets.bottom },
          ]}
          testID={`run-panel-${run.panel}`}
        >
          {/* UX 01 (issue #347): the panel's card content scrolls — a long
              transcript stays readable in Full; the map stays a fixed flex
              child, never a scroll surface. */}
          <ScrollView testID="scroll-run-panel">
            {playingGuide && run.inspected !== playingGuide.stopId ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${strings.nowPlayingLabel}: ${playingName ?? ""}`}
                onPress={() => run.openCard(playingGuide.stopId)}
                style={styles.nowPlayingRow}
                testID="run-nowplaying-row"
              >
                <ScaledText style={styles.nowPlayingText}>
                  {`${strings.nowPlayingLabel}: ${playingName}`}
                </ScaledText>
              </Pressable>
            ) : null}
            {inspectedMarker ? (
              <View style={styles.preview} testID="run-preview">
                <ScaledText style={styles.previewName}>{inspectedMarker.name}</ScaledText>
                <ScaledText style={styles.previewStatus}>{strings.status[inspectedMarker.status]}</ScaledText>
                {/* G06.05 (AC4): the manual play — the GPS-denied row's exit
                    (11 §7: every story plays by hand). The button renders
                    only for a story the engine would actually launch; the
                    launch itself is the engine's UserSelectedStory path. */}
                {session !== null &&
                session.phase === "Active" &&
                inspectedMarker.status !== "locked" &&
                storyPlayable(activeStoryId) ? (
                  <PressableSurface
                    accessibilityRole="button"
                    accessibilityLabel={strings.playAudio}
                    accessibilityHint={strings.playStoryHint}
                    onPress={() => activeStoryId !== undefined && run.selectStory(inspectedMarker.stopId, activeStoryId)}
                    style={styles.readButton}
                    testID="btn-card-play"
                  >
                    <ScaledText style={styles.readLabel}>{strings.playAudio}</ScaledText>
                  </PressableSurface>
                ) : null}
                {run.panel === "full" && hasExtended ? (
                  // G06.05 (AC3): the story-layer switch — every story's
                  // transcript is reachable, the base one is not the only
                  // one. The switch belongs to this card only.
                  <View style={styles.layerRow} testID="run-story-layers">
                    <PressableSurface
                      accessibilityRole="button"
                      accessibilityLabel={strings.storyBase}
                      accessibilityState={{ selected: activeLayer === "base" }}
                      onPress={() => setLayerByStop({ stopId: inspectedMarker.stopId, layer: "base" })}
                      style={[styles.layerTab, activeLayer === "base" && styles.layerTabActive]}
                      testID="btn-story-base"
                    >
                      <ScaledText style={styles.layerLabel}>{strings.storyBase}</ScaledText>
                    </PressableSurface>
                    <PressableSurface
                      accessibilityRole="button"
                      accessibilityLabel={strings.storyExtended}
                      accessibilityState={{ selected: activeLayer === "extended" }}
                      onPress={() => setLayerByStop({ stopId: inspectedMarker.stopId, layer: "extended" })}
                      style={[styles.layerTab, activeLayer === "extended" && styles.layerTabActive]}
                      testID="btn-story-extended"
                    >
                      <ScaledText style={styles.layerLabel}>{strings.storyExtended}</ScaledText>
                    </PressableSurface>
                  </View>
                ) : null}
                {run.panel === "full" ? (
                  // The transcript belongs to the inspected card (11 §3.2), not
                  // to the audible story. The pinned layer's stops.json names
                  // it; a story without a readable transcript keeps the honest
                  // pending note — never invented text.
                  <View testID="run-transcript">
                    <ScaledText style={styles.transcriptHeading}>{strings.transcript}</ScaledText>
                    <ScaledText style={styles.transcriptBody}>
                      {inspectedTranscript ?? strings.transcriptPending}
                    </ScaledText>
                  </View>
                ) : null}
                {run.panel === "half" ? (
                  <PressableSurface
                    accessibilityRole="button"
                    accessibilityLabel={strings.readMore}
                    onPress={() => run.expandPanel()}
                    style={styles.readButton}
                    testID="btn-panel-read"
                  >
                    <ScaledText style={styles.readLabel}>{strings.readMore}</ScaledText>
                  </PressableSurface>
                ) : null}
                <PressableSurface
                  accessibilityRole="button"
                  accessibilityLabel={strings.close}
                  onPress={() => run.dismissPanel()}
                  style={styles.closeButton}
                  testID="btn-panel-close"
                >
                  <ScaledText style={styles.closeLabel}>{strings.close}</ScaledText>
                </PressableSurface>
              </View>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
      {endConfirm ? (
        // UX 06 (issue #352) AC3: the confirmation is a real modal — the
        // decline (and the system Back, the shell's onRequestClose) leaves
        // the session active and unchanged; the confirmation runs the same
        // end() the button used to call.
        <ModalDialog onRequestClose={() => setEndConfirm(false)} testID="end-confirm-dialog">
          <ScaledText style={styles.confirmText}>{strings.endConfirmTitle}</ScaledText>
          <ModalDialogAccept
            label={strings.endConfirmAccept}
            onPress={() => {
              setEndConfirm(false);
              run.end();
            }}
            testID="btn-end-confirm-accept"
          />
          <ModalDialogCancel
            label={strings.endConfirmCancel}
            onPress={() => setEndConfirm(false)}
            testID="btn-end-confirm-cancel"
          />
        </ModalDialog>
      ) : null}
    </View>
  );
}

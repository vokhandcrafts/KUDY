// G06.02 (issue #278) — the Run surface (11 §6): the route's points on an
// honest schematic map — no tile engine exists until the map decision
// (ADR G00.02) is accepted — with the five marker states computed by the
// engine (ADR G01.01 §4.5), the POI points visually distinct from the audio
// points, and the ODbL attribution visible and tappable. A marker tap opens
// the point preview and nothing else: no audio, no session change (11 §6).
// The walk itself lives in the run controller the composition root built —
// this surface owns no GPS, no player and no engine (AC4).
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { runMapView, runMapReason, runMapStrings } from "../../controllers/run/runMap";
import { useRunState, useRunSurface } from "../../controllers/run/runSurfaceController";
import { tokens } from "../design-tokens";
import { useServices } from "../_layout";

const OSM_ATTRIBUTION_URL = "https://www.openstreetmap.org/copyright";

// The marker fills use only the approved tokens (G06.07 canon); a status is
// a word first — the color is the second channel (G06.06 contrast rules).
const STATUS_COLOR: Record<string, string> = {
  playing: tokens.colorAccent,
  played: tokens.colorMuted,
  available: tokens.colorNoticeBorder,
  pending: tokens.colorCard,
  locked: tokens.colorLine,
};

const styles = StyleSheet.create({
  screen: {
    backgroundColor: tokens.colorPaper,
    flex: 1,
    padding: tokens.spaceL,
  },
  back: {
    color: tokens.colorAccent,
    fontSize: tokens.fontBaseSize,
    marginBottom: tokens.spaceS,
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
    backgroundColor: tokens.colorCard,
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
    position: "absolute",
    width: 120,
  },
  dot: {
    borderColor: tokens.colorInk,
    borderRadius: 999,
    borderWidth: 1,
    height: 18,
    width: 18,
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
    fontSize: 11,
    marginTop: 2,
    textAlign: "center",
  },
  poiLabel: {
    color: tokens.colorMuted,
    fontSize: 10,
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
    color: tokens.colorMuted,
    fontSize: 11,
    marginTop: tokens.spaceS,
  },
});

export default function Run() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const services = useServices();
  const routeId = typeof id === "string" ? id : "";
  const surface = useRunSurface(services.run, routeId);
  const ready = surface?.status === "ready" ? surface : null;
  const run = useRunState(ready?.controller ?? null);
  const strings = runMapStrings(ready?.locale ?? "be");
  const [selected, setSelected] = useState<string | null>(null);

  if (surface === null || surface.status === "unavailable") {
    return (
      <View style={styles.screen} testID="screen-Run">
        <Pressable onPress={() => router.back()} style={styles.back} testID="btn-run-back">
          {strings.back}
        </Pressable>
        <Text style={styles.centered}>{strings.unavailableTitle}</Text>
        {surface !== null ? (
          <Text style={styles.reason} testID="run-unavailable-reason">
            {runMapReason(surface.reason, strings)}
          </Text>
        ) : null}
      </View>
    );
  }
  if (surface.status === "loading" || run === null) {
    return (
      <View style={styles.screen} testID="screen-Run">
        <Text style={styles.centered}>{strings.loading}</Text>
      </View>
    );
  }
  const view = runMapView(run.run, surface.stops, surface.facts, surface.places, [surface.locale, "be", "en"]);
  const selectedMarker = view.markers.find((marker) => marker.stopId === selected) ?? null;
  const preview = selectedMarker
    ? {
        name: selectedMarker.name,
        status: strings.status[selectedMarker.status],
      }
    : null;
  return (
    <View style={styles.screen} testID="screen-Run">
      <Pressable onPress={() => router.back()} style={styles.back} testID="btn-run-back">
        {strings.back}
      </Pressable>
      {run.run.phase === "Paused" ? (
        <View style={styles.pausedBanner} testID="run-paused">
          <Text style={styles.pausedText}>{strings.pausedTitle}</Text>
          <Pressable
            onPress={() => run.resumeSession()}
            style={styles.resumeButton}
            testID="btn-run-resume"
          >
            <Text style={styles.resumeLabel}>{strings.resume}</Text>
          </Pressable>
        </View>
      ) : null}
      {run.run.phase === "Ended" ? (
        <Text style={styles.centered} testID="run-ended">
          {strings.endedTitle}
        </Text>
      ) : null}
      {view.markers.length > 0 ? (
        <View style={styles.map} testID="run-map">
          {view.pois.map((poi) => (
            <View
              key={poi.placeId}
              style={[styles.marker, { left: `${poi.nx * 100}%`, top: `${poi.ny * 100}%`, transform: [{ translateX: -60 }, { translateY: -9 }] }]}
              testID={`run-poi-${poi.placeId}`}
            >
              <View style={styles.poi} />
              <Text style={styles.poiLabel}>{poi.kind}</Text>
            </View>
          ))}
          {view.markers.map((marker) => (
            <Pressable
              key={marker.stopId}
              accessibilityHint={strings.markerHint}
              accessibilityLabel={`${marker.name}, ${strings.status[marker.status]}`}
              onPress={() => setSelected(marker.stopId)}
              style={[
                styles.marker,
                { left: `${marker.nx * 100}%`, top: `${marker.ny * 100}%`, transform: [{ translateX: -60 }, { translateY: -9 }] },
              ]}
              testID={`run-marker-${marker.stopId}`}
            >
              <View style={[styles.dot, { backgroundColor: STATUS_COLOR[marker.status] }]} />
              <Text style={styles.markerLabel} testID={`run-status-${marker.stopId}`}>
                {`${marker.name} — ${strings.status[marker.status]}`}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Text style={styles.note}>{strings.schematicNote}</Text>
      <Text
        onPress={() => void Linking.openURL(OSM_ATTRIBUTION_URL)}
        style={styles.attribution}
        testID="map-attribution"
      >
        {strings.attribution}
      </Text>
      {preview ? (
        <View style={styles.preview} testID="run-preview">
          <Text style={styles.previewName}>{preview.name}</Text>
          <Text style={styles.previewStatus}>{preview.status}</Text>
          <Pressable onPress={() => setSelected(null)} style={styles.closeButton} testID="btn-preview-close">
            <Text style={styles.closeLabel}>{strings.close}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

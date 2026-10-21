import { Camera, Map, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import LocateFixedIcon from 'lucide-react-native/icons/locate-fixed';
import ListIcon from 'lucide-react-native/icons/list';

import type { RunMapView } from '../controllers/run/runMap.ts';
import type { RunStop } from '../controllers/run/runOrchestrator.ts';
import type { RunPlaceFact } from '../services/contentRepo/runMapFacts.ts';
import { tokens } from './design-tokens.ts';
import { ScaledText } from './scaled-text.tsx';
import { mapProvider } from '../contracts/map-provider.ts';

const FOLLOW_ZOOM = 16;
const CAMERA_DURATION_MS = 650;

const styles = StyleSheet.create({
  frame: {
    backgroundColor: tokens.colorMap,
    borderColor: tokens.colorLine,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    flex: 1,
    overflow: 'hidden',
  },
  map: { ...StyleSheet.absoluteFillObject },
  fallback: { ...StyleSheet.absoluteFillObject },
  marker: { alignItems: 'center', minHeight: 48, width: 120 },
  dot: {
    borderColor: tokens.colorAccentInk,
    borderRadius: 999,
    borderWidth: 2,
    height: tokens.markerSize,
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
  position: {
    backgroundColor: '#1677d2',
    borderColor: '#ffffff',
    borderRadius: 999,
    borderWidth: 3,
    height: 20,
    width: 20,
  },
  label: { color: tokens.colorInk, fontSize: 12, marginTop: 2, textAlign: 'center' },
  recenter: {
    alignItems: 'center',
    backgroundColor: tokens.colorPaper,
    borderColor: tokens.colorLine,
    borderRadius: 999,
    borderWidth: 1,
    bottom: tokens.spaceM,
    height: 48,
    justifyContent: 'center',
    position: 'absolute',
    right: tokens.spaceM,
    width: 48,
  },
  pointsButton: {
    alignItems: 'center', backgroundColor: tokens.colorPaper, borderColor: tokens.colorLine,
    borderRadius: 999, borderWidth: 1, height: 48, justifyContent: 'center',
    position: 'absolute', right: tokens.spaceM, top: tokens.spaceM, width: 48,
  },
  pointsList: {
    backgroundColor: tokens.colorPaper, borderColor: tokens.colorLine,
    borderRadius: tokens.radiusBase, borderWidth: 1, left: tokens.spaceM,
    maxHeight: 240, position: 'absolute', right: tokens.spaceM, top: 64,
  },
  pointsRow: { minHeight: 48, justifyContent: 'center', paddingHorizontal: tokens.spaceM },
  retry: { alignSelf: 'center', backgroundColor: tokens.colorPaper, borderRadius: tokens.radiusBase, bottom: tokens.spaceM, minHeight: 48, justifyContent: 'center', paddingHorizontal: tokens.spaceM, position: 'absolute' },
});

export function RunNativeMap({
  view,
  stops,
  places,
  fallback,
  onMapPosition,
  onOpenStop,
  onReadyChange,
  nativeDisabled = false,
  recenterLabel,
  pointsLabel,
  retryLabel,
  markerHint,
  statusWords,
  statusColors,
  poiWords,
}: {
  view: RunMapView;
  stops: ReadonlyArray<RunStop>;
  places: ReadonlyArray<RunPlaceFact>;
  fallback: ReactNode;
  onMapPosition: (handler: (center: [number, number]) => void) => () => void;
  onOpenStop: (stopId: string) => void;
  onReadyChange: (ready: boolean) => void;
  nativeDisabled?: boolean;
  recenterLabel: string;
  pointsLabel: string;
  retryLabel: string;
  markerHint: string;
  statusWords: Record<string, string>;
  statusColors: Record<string, string>;
  poiWords: Record<string, string>;
}) {
  const camera = useRef<CameraRef>(null);
  const smoothed = useRef<[number, number] | null>(null);
  const following = useRef(true);
  const loadedRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [showRecenter, setShowRecenter] = useState(false);
  const [showPoints, setShowPoints] = useState(false);
  const [position, setPosition] = useState<[number, number] | null>(null);
  const stopCoordinates = useMemo(() => new globalThis.Map(stops.map((stop) => [stop.stopId, [stop.lng, stop.lat] as [number, number]])), [stops]);
  const placeCoordinates = useMemo(() => new globalThis.Map(places.map((place) => [place.placeId, [place.lng, place.lat] as [number, number]])), [places]);
  // A restored session can name a stop whose pinned geometry is absent.
  // The schematic has an explicit center fallback; the native map cannot
  // silently drop that status marker.
  const mapRenderable = !nativeDisabled && stops.length > 0 && view.markers.every((marker) => stopCoordinates.has(marker.stopId));
  const initialViewState = useMemo(() => {
    if (stops.length === 0) return undefined;
    const west = Math.min(...stops.map((point) => point.lng));
    const east = Math.max(...stops.map((point) => point.lng));
    const south = Math.min(...stops.map((point) => point.lat));
    const north = Math.max(...stops.map((point) => point.lat));
    return west === east && south === north
      ? { center: [west, south] as [number, number], zoom: FOLLOW_ZOOM }
      : { bounds: [west, south, east, north] as [number, number, number, number], padding: { top: 40, right: 40, bottom: 40, left: 40 } };
  }, [stops]);

  useEffect(() => {
    if (!mapRenderable) {
      loadedRef.current = false;
      setLoaded(false);
      onReadyChange(false);
    }
  }, [mapRenderable, onReadyChange]);

  useEffect(() => onMapPosition((center) => {
    smoothed.current = center;
    setPosition(smoothed.current);
    if (loadedRef.current && following.current) {
      camera.current?.easeTo({ center: smoothed.current, zoom: FOLLOW_ZOOM, duration: CAMERA_DURATION_MS, easing: 'ease' });
    }
  }), [onMapPosition]);

  const recenter = () => {
    const position = smoothed.current;
    if (!position) return;
    following.current = true;
    setShowRecenter(false);
    camera.current?.easeTo({ center: position, zoom: FOLLOW_ZOOM, duration: CAMERA_DURATION_MS, easing: 'ease' });
  };

  return (
    <View style={styles.frame} testID="run-map">
      {!failed && mapRenderable ? (
        <Map
          key={retryKey}
          mapStyle={mapProvider.styleUrl}
          style={styles.map}
          attribution
          onDidFinishLoadingMap={() => {
            loadedRef.current = true;
            setLoaded(true);
            onReadyChange(true);
            if (smoothed.current && following.current) {
              camera.current?.easeTo({ center: smoothed.current, zoom: FOLLOW_ZOOM, duration: CAMERA_DURATION_MS, easing: 'ease' });
            }
          }}
          onDidFailLoadingMap={() => { loadedRef.current = false; setFailed(true); setLoaded(false); onReadyChange(false); }}
          onRegionWillChange={(event) => {
            if (event.nativeEvent.userInteraction) {
              following.current = false;
              setShowRecenter(true);
            }
          }}
          testID="run-native-map"
        >
          <Camera ref={camera} initialViewState={initialViewState} />
          {loaded && position ? (
            <Marker id="current-position" lngLat={position}>
              <View style={styles.position} testID="run-current-position" />
            </Marker>
          ) : null}
          {loaded ? view.pois.map((poi) => {
            const coordinate = placeCoordinates.get(poi.placeId);
            if (!coordinate) return null;
            return (
              <Marker key={poi.placeId} id={poi.placeId} lngLat={coordinate}>
                <View style={styles.marker} testID={`run-poi-${poi.placeId}`}>
                  <View style={styles.poi} />
                  {poiWords[poi.kind] ? <ScaledText style={styles.label}>{poiWords[poi.kind]}</ScaledText> : null}
                </View>
              </Marker>
            );
          }) : null}
          {loaded ? view.markers.map((marker) => {
            const coordinate = stopCoordinates.get(marker.stopId);
            if (!coordinate) return null;
            return (
              <Marker key={marker.stopId} id={marker.stopId} lngLat={coordinate}>
                <Pressable
                  style={styles.marker}
                  onPress={() => onOpenStop(marker.stopId)}
                  accessibilityRole="button"
                  accessibilityLabel={`${marker.name}, ${statusWords[marker.status]}`}
                  accessibilityHint={markerHint}
                  testID={`run-marker-${marker.stopId}`}
                >
                  <View style={[styles.dot, { backgroundColor: statusColors[marker.status] }]} />
                  <ScaledText style={styles.label} testID={`run-status-${marker.stopId}`}>
                    {`${marker.name} — ${statusWords[marker.status]}`}
                  </ScaledText>
                </Pressable>
              </Marker>
            );
          }) : null}
        </Map>
      ) : null}
      {!loaded || !mapRenderable ? <View style={styles.fallback}>
        {fallback}
        {failed && mapRenderable ? <Pressable
          style={styles.retry}
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          onPress={() => { setFailed(false); setRetryKey((key) => key + 1); }}
          testID="run-map-retry"
        ><ScaledText>{retryLabel}</ScaledText></Pressable> : null}
      </View> : null}
      {loaded && showRecenter && smoothed.current ? (
        <Pressable
          style={styles.recenter}
          onPress={recenter}
          accessibilityRole="button"
          accessibilityLabel={recenterLabel}
          testID="run-map-recenter"
        >
          <LocateFixedIcon size={24} color={tokens.colorInk} />
        </Pressable>
      ) : null}
      {loaded ? (
        <Pressable
          style={styles.pointsButton}
          onPress={() => setShowPoints((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel={pointsLabel}
          accessibilityState={{ expanded: showPoints }}
          testID="run-map-points"
        >
          <ListIcon size={24} color={tokens.colorInk} />
        </Pressable>
      ) : null}
      {loaded && showPoints ? (
        <ScrollView style={styles.pointsList} testID="run-map-points-list">
          {view.markers.map((marker) => (
            <Pressable
              key={marker.stopId}
              style={styles.pointsRow}
              onPress={() => { setShowPoints(false); onOpenStop(marker.stopId); }}
              accessibilityRole="button"
              accessibilityLabel={`${marker.name}, ${statusWords[marker.status]}`}
              accessibilityHint={markerHint}
              testID={`run-point-${marker.stopId}`}
            >
              <ScaledText testID={`run-point-status-${marker.stopId}`}>
                {`${marker.name} — ${statusWords[marker.status]}`}
              </ScaledText>
            </Pressable>
          ))}
          {view.pois.length > 0 ? <View testID="run-poi-points-group">
            {view.pois.map((poi) => poiWords[poi.kind] ? (
              <View key={poi.placeId} style={styles.pointsRow} accessible accessibilityLabel={poiWords[poi.kind]} testID={`run-poi-point-${poi.placeId}`}>
                <ScaledText>{poiWords[poi.kind]}</ScaledText>
              </View>
            ) : null)}
          </View> : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

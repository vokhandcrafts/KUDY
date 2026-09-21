// The client half of the static city map (G10.01.b step 3): MapLibre GL JS
// initializes after hydration, fits the marker bounds — no hardcoded city
// copy — and renders tiles from the single recorded provider only
// (lib/map-config.ts). Markers are non-interactive dots: no popups, no
// playback, no links (acceptance 4). The map is removed on unmount.
'use client';

import { useEffect, useRef } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { MapMarkers } from '../lib/content/site.ts';
import { mapProvider } from '../lib/map-config.ts';

export function CityMap({ markers, label }: { markers: MapMarkers; label: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let disposed = false;
    let map: MapLibreMap | null = null;
    // A failed map init must be visible, never a silent empty box: the
    // failure lands on the container as data-map-error (and the console).
    const fail = (error: unknown) => {
      console.error('city map init failed', error);
      if (containerRef.current) containerRef.current.dataset.mapError = String(error);
    };
    void (async () => {
      try {
        const maplibregl = (await import('maplibre-gl')).default;
        if (disposed || !containerRef.current) return;
        map = new maplibregl.Map({
          container: containerRef.current,
          style: mapProvider.styleUrl,
        });
        map.on('load', () => {
          try {
            if (disposed || !map) return;
            map.addSource('stops', { type: 'geojson', data: markers });
            map.addLayer({
              id: 'stops',
              type: 'circle',
              source: 'stops',
              paint: {
                'circle-color': ['case', ['get', 'locked'], '#9aa0a6', '#1a7f37'],
                'circle-radius': 7,
                'circle-stroke-width': 2,
                'circle-stroke-color': '#ffffff',
              },
            });
            const coords = markers.features.map((feature) => feature.geometry.coordinates);
            if (coords.length === 1) {
              map.jumpTo({ center: coords[0]!, zoom: 14 });
            } else if (coords.length > 1) {
              const lngs = coords.map(([lng]) => lng);
              const lats = coords.map(([, lat]) => lat);
              // Instant camera set, no animation: the map is a static
              // overview — and an rAF-driven fly never advances in an
              // occluded/headless pane, freezing the view at world zoom.
              map.fitBounds(
                [
                  [Math.min(...lngs), Math.min(...lats)],
                  [Math.max(...lngs), Math.max(...lats)],
                ],
                { padding: 24, maxZoom: 15, animate: false },
              );
            }
            if (containerRef.current) containerRef.current.dataset.mapReady = 'fitted';
          } catch (error) {
            fail(error);
          }
        });
      } catch (error) {
        fail(error);
      }
    })();
    return () => {
      disposed = true;
      map?.remove();
    };
  }, [markers]);

  return <div ref={containerRef} aria-label={label} style={{ height: 360 }} />;
}

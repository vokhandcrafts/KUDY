// The client half of the static city map (G10.01.b step 3): MapLibre GL JS
// initializes after hydration, fits the marker bounds — no hardcoded city
// copy — and renders tiles from the single recorded provider only
// (lib/map-config.ts). Markers are non-interactive dots: no popups, no
// playback, no links (acceptance 4). The map is removed on unmount.
// A failed init must never be a silent empty box (G21.03): the failure
// lands on the container as data-map-error and beside it a localized
// accessible message renders — never the raw exception or a URL. A
// successful load clears the message again; post-load tile errors are
// transient — the initialized map keeps working, so they stay console-only.
'use client';

import { useEffect, useRef } from 'react';
// MapLibre positions its canvas and legal controls only through this
// stylesheet, pinned to the package version. Without the import the
// attribution control renders in static flow, overflows the map container
// and collides with the server-side ODbL attribution below (G21.02).
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { MapMarkers } from '../lib/content/site.ts';
import { mapProvider } from '../lib/map-config.ts';

export function CityMap({ markers, label, errorText }: {
  markers: MapMarkers;
  label: string;
  errorText: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const errorRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    let disposed = false;
    let loaded = false;
    let map: MapLibreMap | null = null;
    const fail = (error: unknown) => {
      console.error('city map init failed', error);
      if (loaded) return;
      if (containerRef.current) containerRef.current.dataset.mapError = String(error);
      if (errorRef.current) errorRef.current.hidden = false;
    };
    const succeed = () => {
      if (containerRef.current) delete containerRef.current.dataset.mapError;
      if (errorRef.current) errorRef.current.hidden = true;
    };
    void (async () => {
      try {
        const maplibregl = (await import('maplibre-gl')).default;
        if (disposed || !containerRef.current) return;
        map = new maplibregl.Map({
          container: containerRef.current,
          style: mapProvider.styleUrl,
        });
        // Async style/tile failures (offline visitor, provider outage) never
        // reach the synchronous catch — they land here and become visible.
        map.on('error', fail);
        map.on('load', () => {
          if (disposed || !map) return;
          loaded = true;
          succeed();
          try {
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

  return (
    <>
      <div ref={containerRef} role="region" aria-label={label} style={{ height: 360 }} />
      <p ref={errorRef} role="status" hidden>
        {errorText}
      </p>
    </>
  );
}

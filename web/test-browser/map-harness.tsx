// Test-only browser harness (G21.03): mounts the real MapPage component with
// the real locale strings and a synthetic fixture, and exposes mount/unmount
// controls to the CDP driver. Never imported by the app — served from
// test-browser/ only, so the browser proof exercises the production page
// code path rather than a copy of it.
import { createRoot } from 'react-dom/client';
import { MapPage } from '../components/map-page.tsx';
import { getUiStrings } from '../lib/i18n/index.ts';
import type { MapPageData } from '../lib/content/site.ts';

const fixture: MapPageData = {
  cityId: 'demo-city',
  routes: [
    {
      route_id: 'demo-route-a1',
      title: 'Дэма-гід: сукнаны двор',
      href: '/guides/demo-route-a1',
      stops: [
        { stop_id: 'stop-1', place_id: 'place-1', name: 'Двор сукнараў (дэма)', locked: false, lat: 54.3487, lng: 18.6534 },
        { stop_id: 'stop-2', place_id: 'place-2', name: 'Млынавая калона (дэма)', locked: true, lat: 54.3512, lng: 18.652 },
      ],
    },
    {
      route_id: 'demo-route-b2',
      title: 'Дэма-гід: водны шлях',
      href: '/guides/demo-route-b2',
      stops: [
        { stop_id: 'stop-3', place_id: 'place-3', name: 'Водны шлях (дэма)', locked: false, lat: 54.3555, lng: 18.648 },
      ],
    },
  ],
  markers: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [18.6534, 54.3487] },
        properties: { route_id: 'demo-route-a1', stop_id: 'stop-1', name: 'Двор сукнараў (дэма)', locked: false },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [18.652, 54.3512] },
        properties: { route_id: 'demo-route-a1', stop_id: 'stop-2', name: 'Млынавая калона (дэма)', locked: true },
      },
    ],
  },
};

declare global {
  interface Window {
    __mapHarness: {
      mount: (locale: 'be' | 'en') => void;
      unmount: () => void;
    };
  }
}

let root: ReturnType<typeof createRoot> | null = null;

function mount(locale: 'be' | 'en') {
  const container = document.getElementById('root');
  if (!container) throw new Error('harness root element missing');
  root = createRoot(container);
  root.render(<MapPage locale={locale} data={fixture} strings={getUiStrings(locale)} />);
}

function unmount() {
  root?.unmount();
  root = null;
}

window.__mapHarness = { mount, unmount };

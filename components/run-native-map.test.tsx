import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { expect, jest, test } from '@jest/globals';
import { Text } from 'react-native';

import { RunNativeMap } from './run-native-map';

const { cameraCalls } = require('../test/maplibre-react-native-mock') as {
  cameraCalls: Array<{ center: [number, number]; zoom: number; duration: number }>;
};

const props = {
  view: {
    markers: [{ stopId: 'stop-1', name: 'Мытня', status: 'available' as const, nx: 0.5, ny: 0.5 }],
    pois: [],
  },
  stops: [{ stopId: 'stop-1', lat: 54.35, lng: 18.65, radius: 30 }],
  places: [],
  fallback: <Text testID="map-fallback">Схема</Text>,
  onOpenStop: jest.fn(),
  onReadyChange: jest.fn(),
  recenterLabel: 'Да майго месцазнаходжання',
  pointsLabel: 'Кропкі маршруту',
  retryLabel: 'Паўтарыць',
  markerHint: 'Прагляд кропкі. Аўдыё не запускаецца.',
  statusWords: { available: 'даступна' },
  statusColors: { available: '#123456' },
  poiWords: {},
};

test('loaded native map uses geographic markers and the walk GPS observer', () => {
  cameraCalls.length = 0;
  let positionHandler: ((center: [number, number]) => void) | null = null;
  const unsubscribe = jest.fn();
  const onMapPosition = jest.fn((handler: (center: [number, number]) => void) => { positionHandler = handler; return unsubscribe; });
  const rendered = render(<RunNativeMap {...props} onMapPosition={onMapPosition} />);
  expect(screen.getByTestId('map-fallback')).toBeTruthy();
  act(() => fireEvent(screen.getByTestId('run-native-map'), 'onDidFinishLoadingMap'));
  expect(screen.queryByTestId('map-fallback')).toBeNull();
  expect(props.onReadyChange).toHaveBeenLastCalledWith(true);
  expect(screen.getByTestId('mock-map-marker-stop-1').props.lngLat).toEqual([18.65, 54.35]);
  expect(screen.getByTestId('run-marker-stop-1')).toBeTruthy();
  expect(screen.getByTestId('run-marker-stop-1').props.accessibilityHint).toBe(props.markerHint);
  fireEvent.press(screen.getByTestId('run-map-points'));
  expect(screen.getByTestId('run-point-status-stop-1').props.children).toBe('Мытня — даступна');
  expect(screen.getByTestId('run-point-stop-1').props.accessibilityHint).toBe(props.markerHint);
  fireEvent.press(screen.getByTestId('run-point-stop-1'));
  expect(props.onOpenStop).toHaveBeenCalledWith('stop-1');
  act(() => positionHandler?.([18.651, 54.351]));
  expect(screen.getByTestId('run-current-position')).toBeTruthy();
  expect(cameraCalls.at(-1)).toEqual(expect.objectContaining({ center: [18.651, 54.351], zoom: 16 }));
  expect(onMapPosition).toHaveBeenCalledTimes(1);
  rendered.unmount();
  expect(unsubscribe).toHaveBeenCalled();
});

test('a user pan pauses camera follow until recenter; tile failure keeps the schematic', () => {
  cameraCalls.length = 0;
  let positionHandler: ((center: [number, number]) => void) | null = null;
  const onMapPosition = (handler: (center: [number, number]) => void) => { positionHandler = handler; return () => {}; };
  render(<RunNativeMap {...props} onMapPosition={onMapPosition} />);
  const map = screen.getByTestId('run-native-map');
  act(() => fireEvent(map, 'onDidFinishLoadingMap'));
  act(() => positionHandler?.([18.651, 54.351]));
  const beforePan = cameraCalls.length;
  act(() => fireEvent(map, 'onRegionWillChange', { nativeEvent: { userInteraction: true } }));
  act(() => positionHandler?.([18.652, 54.352]));
  expect(cameraCalls).toHaveLength(beforePan);
  fireEvent.press(screen.getByTestId('run-map-recenter'));
  expect(cameraCalls).toHaveLength(beforePan + 1);
  expect(screen.queryByTestId('run-map-recenter')).toBeNull();
  act(() => fireEvent(map, 'onDidFailLoadingMap'));
  expect(screen.getByTestId('map-fallback')).toBeTruthy();
  expect(props.onReadyChange).toHaveBeenLastCalledWith(false);
  fireEvent.press(screen.getByTestId('run-map-retry'));
  expect(screen.getByTestId('run-native-map')).toBeTruthy();
  act(() => fireEvent(screen.getByTestId('run-native-map'), 'onDidFinishLoadingMap'));
  expect(screen.queryByTestId('map-fallback')).toBeNull();
  expect(props.onReadyChange).toHaveBeenLastCalledWith(true);
});

test('points list exposes labelled POIs without a stop-card action', () => {
  render(<RunNativeMap {...props} view={{ ...props.view, pois: [{ placeId: 'poi-1', kind: 'cafe', nx: 0.5, ny: 0.5 }] }}
    places={[{ placeId: 'poi-1', lat: 54.36, lng: 18.66, radius: 10, kind: 'cafe' }]}
    poiWords={{ cafe: 'Кавярня' }} onMapPosition={() => () => {}} />);
  act(() => fireEvent(screen.getByTestId('run-native-map'), 'onDidFinishLoadingMap'));
  fireEvent.press(screen.getByTestId('run-map-points'));
  expect(screen.getByTestId('run-poi-points-group')).toBeTruthy();
  expect(screen.getByTestId('run-poi-point-poi-1').props.accessible).toBe(true);
  expect(screen.getByTestId('run-poi-point-poi-1').props.accessibilityLabel).toBe('Кавярня');
  expect(props.onOpenStop).not.toHaveBeenCalledWith('poi-1');
});

test('missing geometry keeps every session marker on the schematic', () => {
  render(<RunNativeMap
    {...props}
    view={{ markers: [{ stopId: 'missing', name: 'Без каардынатаў', status: 'pending', nx: 0.5, ny: 0.5 }], pois: [] }}
    onMapPosition={() => () => {}}
  />);
  expect(screen.queryByTestId('run-native-map')).toBeNull();
  expect(screen.getByTestId('map-fallback')).toBeTruthy();
});

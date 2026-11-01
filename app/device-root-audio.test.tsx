// G20.29 / #791: the shipped device root must pass its real AudioService the
// Expo speech-mode setter. The downstream composition and OS ports are mocked.
import { expect, jest, test } from '@jest/globals';
import type { AudioService } from '../services/audio/service';

let mockCompleteMode: (() => void) | null = null;
const mockPhysicalPlays: string[] = [];
let mockModeCalls = 0;

jest.mock('expo-audio', () => ({
  setAudioModeAsync: () => {
    mockModeCalls += 1;
    return new Promise<void>((complete) => { mockCompleteMode = complete; });
  },
  createAudioPlayer: (source: { uri: string }) => ({
    addListener() {},
    play() { mockPhysicalPlays.push(source.uri); },
    pause() {},
    setActiveForLockScreen() {},
    clearLockScreenControls() {},
    remove() {},
  }),
}));
jest.mock('expo-sqlite', () => ({ openDatabaseSync: () => ({}) }));
jest.mock('expo-file-system', () => ({
  File: class {},
  Directory: class { constructor(..._parts: unknown[]) {} },
  Paths: { document: '/device', availableDiskSpace: 1000 },
}));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digest: async () => 'digest',
  randomUUID: () => 'uuid',
}));
jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: async () => {},
  deactivateKeepAwake: () => {},
}));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: null } }));
jest.mock('../services/location/expo/expo-location-port', () => ({
  createExpoLocationOsPort: () => ({
    permission: () => ({ foreground: 'unknown', background: 'unknown' }),
    onPortEvent: () => {},
  }),
}));
jest.mock('../services/device-secure-store', () => ({
  expoSecureSecretStore: () => ({}),
}));
jest.mock('../controllers/deviceServices', () => ({
  catalogOriginFrom: () => 'https://catalog.example.test',
  createDeviceServicePorts: (facilities: unknown) => facilities,
}));

import { createDeviceServiceSet } from '../controllers/deviceRoot';

test('G20.29 AC4: device root waits for speech mode before physical playback', async () => {
  const facilities = createDeviceServiceSet() as unknown as { audio: AudioService } | null;
  expect(facilities).not.toBeNull();
  const pending = facilities!.audio.play({
    token: { kind: 'guide', ref: 'device-root', seq: 1 },
    path: 'file:///installed/root.m4a',
  });
  expect(mockModeCalls).toBe(1);
  expect(mockPhysicalPlays).toEqual([]);
  expect(mockCompleteMode).not.toBeNull();
  mockCompleteMode!();
  await pending;
  expect(mockPhysicalPlays).toEqual(['file:///installed/root.m4a']);
});

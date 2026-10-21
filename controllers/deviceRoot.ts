// G20.20 (issue #491) — the app root's binding hand: the ONLY controllers
// module that imports the Expo platform packages at runtime (the OS
// boundary). It constructs the real facilities — the opened SQLite
// database, the digest/uuid mints, the keep-awake lease, the one
// LocationService and AudioService — and hands them to the pure composition
// root (deviceServices.ts). Node tests never import this file (expo modules
// do not resolve under node); the app and jest-expo render tests do.
// An absent configuration (no catalog origin) yields null and the surfaces
// keep their honest unavailable state; purchase/restore stays the
// explicitly-unavailable port until G20.21 wires and verifies the live path.
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import { Directory, File, Paths, type Directory as FsDirectory } from 'expo-file-system';
import { CryptoDigestAlgorithm, digest, randomUUID } from 'expo-crypto';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import Constants from 'expo-constants';
import { AppState } from 'react-native';
import guideHintValues from '../contracts/hints/guide-hints.values.v1.json';

import { AudioService } from '../services/audio/service.ts';
import { configureSpeechAudioMode, createExpoAudioPlayerPort } from '../services/audio/expo/expo-audio-port.ts';
import { LocationService, systemLocationClock } from '../services/location/service.ts';
import { createExpoLocationOsPort } from '../services/location/expo/expo-location-port.ts';
import { createDeviceSha256, newDeviceSessionId } from '../services/device-crypto.ts';
import { createExpoSqliteDriver } from '../services/db/expo/expo-sqlite-driver.ts';
import { expoSecureSecretStore } from '../services/device-secure-store.ts';
import { createE2EFeedbackBindings } from '../services/feedback-e2e.ts';
import { catalogOriginFrom, createDeviceServicePorts } from './deviceServices.ts';

export function createDeviceServiceSet(): ReturnType<typeof createDeviceServicePorts> | null {
  const demo = process.env.EXPO_PUBLIC_DEMO_MODE === '1';
  const origin = demo ? 'demo://embedded' : catalogOriginFrom(process.env);
  if (origin === null) return null;
  const db: SQLiteDatabase = openDatabaseSync('kudy.db');
  const bundlesRoot: FsDirectory = new Directory(Paths.document, 'bundles');
  const extra = (Constants.expoConfig?.extra ?? {}) as {
    locationExplanations?: { foreground: string; background: string };
  };
  const demoSource = demo ? require('./demoCatalog.ts') as typeof import('./demoCatalog.ts') : null;
  const secretStore = expoSecureSecretStore();
  const e2eFeedback = __DEV__ && process.env.EXPO_PUBLIC_E2E_FEEDBACK === '1'
    ? createE2EFeedbackBindings(origin, secretStore)
    : null;
  return createDeviceServicePorts({
    driver: createExpoSqliteDriver(db),
    sha256: createDeviceSha256({
      digest256: async (bytes) => digest(CryptoDigestAlgorithm.SHA256, bytes as unknown as BufferSource),
      randomUUID,
    }),
    newSessionId: () => newDeviceSessionId({ randomUUID }),
    keepAwake: { activate: activateKeepAwakeAsync, deactivate: deactivateKeepAwake },
    location: new LocationService({
      port: createExpoLocationOsPort(),
      clock: systemLocationClock,
      permissions: extra.locationExplanations ?? { foreground: '', background: '' },
    }),
    audio: new AudioService({
      createPort: () => createExpoAudioPlayerPort(),
      configureMode: configureSpeechAudioMode,
    }),
    fileSystem: { File, Directory, freeBytes: () => Paths.availableDiskSpace },
    bundlesRoot,
    origin,
    guideHintValues,
    foreground: () => AppState.currentState === 'active',
    onForeground: (listener) => {
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') listener();
      });
      return () => subscription.remove();
    },
    ...(e2eFeedback ? {
      feedback: { ...e2eFeedback, secretStore },
    } : process.env.EXPO_PUBLIC_FEEDBACK_FUNCTIONS_URL ? {
      feedback: {
        baseUrl: process.env.EXPO_PUBLIC_FEEDBACK_FUNCTIONS_URL,
        secretStore,
      },
    } : {}),
    ...(demoSource ? {
      // The published demo bytes are read by the same catalog/download flow.
      demoSource: { loadText: demoSource.loadDemoText, loadBytes: demoSource.loadDemoBytes },
    } : {}),
  });
}

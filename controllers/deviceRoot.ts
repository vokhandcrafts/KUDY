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

import { AudioService } from '../services/audio/service.ts';
import { createExpoAudioPlayerPort } from '../services/audio/expo/expo-audio-port.ts';
import { LocationService, systemLocationClock } from '../services/location/service.ts';
import { createExpoLocationOsPort } from '../services/location/expo/expo-location-port.ts';
import { createDeviceSha256, newDeviceSessionId } from '../services/device-crypto.ts';
import { createExpoSqliteDriver } from '../services/db/expo/expo-sqlite-driver.ts';
import { createDeviceServicePorts } from './deviceServices.ts';

export function createDeviceServiceSet(): ReturnType<typeof createDeviceServicePorts> | null {
  const origin = process.env.EXPO_PUBLIC_CATALOG_ORIGIN;
  if (!origin) return null;
  const db: SQLiteDatabase = openDatabaseSync('kudy.db');
  const bundlesRoot: FsDirectory = new Directory(Paths.document, 'bundles');
  const extra = (Constants.expoConfig?.extra ?? {}) as {
    locationExplanations?: { foreground: string; background: string };
  };
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
    audio: new AudioService({ createPort: () => createExpoAudioPlayerPort() }),
    fileSystem: { File, Directory, freeBytes: () => Paths.availableDiskSpace },
    bundlesRoot,
    origin,
  });
}

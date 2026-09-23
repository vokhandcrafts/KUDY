// G08.01 — production adapter binding the device secret store to
// expo-secure-store (docs/architecture/09 §5/§6: the secret lives in
// SecureStore, never in SQLite, never in an asset). keychainAccessible
// WHEN_UNLOCKED_THIS_DEVICE_ONLY keeps the secret device-bound and out of
// backups — an OS-behavior claim proven only on device (see the not-run rows
// in docs/agent-tasks/results/G08.01.md), not by unit tests.
import * as SecureStore from 'expo-secure-store';

import type { SecureSecretStore } from './device.ts';

// Storage entry name (a lookup key inside the device's own keychain, not a
// credential): the secret itself is minted by the server at registration.
const secretName = 'kudy.device_secret.v1';

export function expoSecureSecretStore(): SecureSecretStore {
  return {
    getSecret: () => SecureStore.getItemAsync(secretName),
    saveSecret: (value) =>
      SecureStore.setItemAsync(secretName, value, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
    clearSecret: () => SecureStore.deleteItemAsync(secretName),
  };
}

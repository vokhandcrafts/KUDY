// G20.20 — the device digest and session-id mints. The platform facility
// (expo-crypto, the TR-10 candidate the port comments name) is injected, so
// this module is pure wiring: the digest mapping (ArrayBuffer → hex) and the
// client-generated session id rule (ADR G01.03 §3.1). The expo binding
// lives in the app root (app/_layout.tsx); the parity test drives the same
// mapping node:crypto uses.
import type { Sha256 } from './contentRepo/types.ts';

const HEX = '0123456789abcdef';

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (const byte of bytes) out += HEX[(byte & 0xf0) >> 4] + HEX[byte & 0x0f];
  return out;
}

export interface DeviceCrypto {
  /** SHA-256 over raw bytes, raw digest bytes out (expo-crypto digest()). */
  digest256: (bytes: Uint8Array) => Promise<ArrayBuffer>;
  /** A fresh UUID (expo-crypto randomUUID()). */
  randomUUID: () => string;
}

export function createDeviceSha256(crypto: DeviceCrypto): Sha256 {
  return async (bytes) => toHex(await crypto.digest256(bytes));
}

export function newDeviceSessionId(crypto: Pick<DeviceCrypto, 'randomUUID'>): string {
  return crypto.randomUUID();
}

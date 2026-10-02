// G20.06 — unit tests for the one network-privacy N3 endpoint-check owner
// (services/secure-url.ts). Reverting any check inside parseSecureEndpointUrl
// or assertNotRedirected fails here; the transports reuse this owner instead
// of a second variant, so these cases cover the boundary itself
// (implementation-rules 1/14).
import assert from 'node:assert/strict';
import test from 'node:test';

import { assertNotRedirected, parseSecureEndpointUrl, SecureUrlError } from './secure-url.ts';

test('G20.06 a parseable https endpoint passes and is returned as the URL object to fetch', () => {
  const url = parseSecureEndpointUrl('https://example.functions.supabase.co/functions/v1/device', 'device registration');
  assert.equal(url.protocol, 'https:');
  assert.equal(url.href, 'https://example.functions.supabase.co/functions/v1/device');
});

test('G20.06 http, malformed and credential-bearing endpoints are rejected with named diagnostics', () => {
  const rejected = [
    'http://example.invalid/functions/v1/device',
    'not a url at all',
    'https://user:pass@example.invalid/functions/v1/device',
    'https://:secret@example.invalid/functions/v1/device',
  ];
  for (const value of rejected) {
    assert.throws(() => parseSecureEndpointUrl(value, 'device registration'), SecureUrlError);
  }
});

test('G20.06 a rejected endpoint is diagnosed without echoing the URL into the message', () => {
  for (const value of ['http://example.invalid/x', 'https://user:pass@example.invalid/x']) {
    try {
      parseSecureEndpointUrl(value, 'events send');
      assert.fail('the unsafe endpoint must be rejected');
    } catch (error) {
      assert.ok(error instanceof SecureUrlError);
      assert.ok(!error.message.includes('example.invalid'), 'the message must not carry the rejected URL');
    }
  }
});

test('G20.06 corrupt non-string input yields a diagnostic, never a raw parser crash', () => {
  for (const value of [null, undefined, 42, {}, []]) {
    assert.throws(
      () => parseSecureEndpointUrl(value as unknown as string, 'events send'),
      SecureUrlError,
    );
  }
});

test('G20.06 a response whose final URL left the requested endpoint is rejected', () => {
  const requested = parseSecureEndpointUrl('https://example.functions.supabase.co/functions/v1/device', 'device registration');
  assert.throws(
    () => assertNotRedirected(requested, { url: 'https://attacker.example/functions/v1/device' }, 'device registration'),
    SecureUrlError,
  );
});

test('G20.06 the exact requested endpoint and an unreported response URL pass the redirect guard', () => {
  const requested = parseSecureEndpointUrl('https://example.functions.supabase.co/functions/v1/events', 'events send');
  assert.doesNotThrow(() => assertNotRedirected(requested, { url: requested.href }, 'events send'));
  assert.doesNotThrow(() => assertNotRedirected(requested, { url: '' }, 'events send'));
});

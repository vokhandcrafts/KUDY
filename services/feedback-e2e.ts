// Android E2E only: the local synthetic origin speaks the feedback wire
// contract over adb-reversed emulator loopback. Production uses feedbackSync's
// HTTPS transport; this adapter refuses every non-loopback origin.
import type { DeviceRegistrationTransport, SecureSecretStore } from './device.ts';
import type { FeedbackTransport, FeedbackTransportResponse } from './feedbackSync.ts';

const E2E_SECRET = 'kudy-synthetic-feedback-secret';
const E2E_DEVICE_ID = '11111111-1111-4111-8111-111111111111';

export function createE2EFeedbackBindings(origin: string, secretStore: SecureSecretStore): {
  baseUrl: string;
  registrationTransport: DeviceRegistrationTransport;
  transport: FeedbackTransport;
} {
  if (!/^http:\/\/localhost:\d{2,5}$/.test(origin)) {
    throw new Error('e2e-feedback#origin-must-be-emulator-loopback');
  }
  const baseUrl = `${origin}/functions/v1`;
  const send = async (method: 'PUT' | 'POST', suffix: string, body: unknown): Promise<FeedbackTransportResponse> => {
    const secret = await secretStore.getSecret();
    if (secret !== E2E_SECRET) throw new Error('e2e-feedback#identity-missing');
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 5_000);
    try {
      const response = await fetch(`${baseUrl}${suffix}`, {
        method,
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: abort.signal,
      });
      const text = await response.text();
      return { status: response.status, body: text === '' ? null : JSON.parse(text) };
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    baseUrl,
    registrationTransport: {
      register: async () => ({ status: 201, body: { device_id: E2E_DEVICE_ID, device_secret: E2E_SECRET } }),
    },
    transport: {
      put: (body) => send('PUT', '/feedback', body),
      deleteFeedback: (body) => send('POST', '/feedback/delete', body),
      read: (target) => send('POST', '/feedback/read', { target }),
    },
  };
}

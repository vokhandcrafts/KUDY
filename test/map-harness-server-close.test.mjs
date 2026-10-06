import assert from 'node:assert/strict';
import net from 'node:net';
import { test } from 'node:test';
import { startMapHarnessServer } from '../web/test-browser/map-harness-server.mjs';

test('harness server close does not wait on a half-open connection', async () => {
  const server = await startMapHarnessServer();
  const socket = net.connect(server.port, '127.0.0.1');
  try {
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    // Headers never finish, so the socket stays "sending a request".
    // server.close() alone waits out headersTimeout (60s).
    socket.write('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n');
    const started = Date.now();
    const outcome = await Promise.race([
      server.close().then(() => 'closed'),
      new Promise(resolve => setTimeout(() => resolve('pending'), 1000)),
    ]);
    assert.equal(outcome, 'closed');
    assert.ok(Date.now() - started < 1000);
  } finally {
    socket.destroy();
  }
});

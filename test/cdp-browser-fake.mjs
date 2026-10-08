import { EventEmitter } from 'node:events';
import { mock } from 'node:test';

// Shared stand-in for the Chromium process and the DevTools socket. The
// close suite and the command-timeout suite both drive the real
// launchBrowser; only the socket reply differs.
export function installCdpFakes({ onSend } = {}) {
  const state = {
    child: null,
    profileDir: null,
    spawnArgs: null,
    spawnOptions: null,
  };
  mock.module('node:child_process', {
    namedExports: {
      spawn(_binary, args, options) {
        state.spawnArgs = args;
        state.spawnOptions = options;
        state.profileDir = args.find((arg) => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
        const child = new EventEmitter();
        child.stderr = new EventEmitter();
        child.killed = false;
        child.kill = () => {
          child.killed = true;
          return true;
        };
        state.child = child;
        setImmediate(() => child.stderr.emit('data', 'DevTools listening on ws://127.0.0.1/synthetic'));
        return child;
      },
    },
  });

  class FakeSocket extends EventTarget {
    closed = false;
    constructor() {
      super();
      queueMicrotask(() => this.dispatchEvent(new Event('open')));
    }
    send(payload) {
      if (onSend) onSend(payload, this);
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      this.dispatchEvent(new Event('close'));
    }
  }
  mock.method(globalThis, 'WebSocket', function () { return new FakeSocket(); });
  return state;
}

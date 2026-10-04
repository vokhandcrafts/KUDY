// G16.02 — the Showboat demo scenario (issue #73): the feedback queue's
// crash window and honest recovery over a real file-backed SQLite store.
// Deterministic by construction: fixed ids, fixed clock, scripted transport.
// Run: node --experimental-strip-types tests/feedback/queue-demo.ts
import fs from 'node:fs';

import { openDatabase, setDeviceId } from '../../services/db/db.ts';
import { nodeSqliteFileDriver } from '../../services/db/test-fixture.ts';
import type { SqlDriver } from '../../services/db/types.ts';
import { saveDraft, sendNow } from '../../services/feedbackRepository.ts';
import { createFeedbackSync } from '../../services/feedbackSync.ts';

const NOW = 1_770_000_000_000;
const TARGET = { kind: 'guide' as const, id: 'guide-route-a1', version: '1', locale: 'be' };
const MUTATION = '00000000-0000-4000-8000-000000000001';
const DIR = '/tmp/kudy-g1602-demo';
const FILE = `${DIR}/queue.db`;

function state(driver: SqlDriver, label: string): void {
  const local = driver.prepare('SELECT state, revision, score, draft FROM feedback_local').get();
  const outbox = driver.prepare('SELECT transport_state, attempts, next_attempt_at FROM feedback_outbox').all();
  console.log(`${label}: local=${JSON.stringify(local)} outbox=${JSON.stringify(outbox)}`);
}

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

// 1. The user saves a rating and hits Send — the draft and the operation are
// one transaction before the network (`21` §5.4).
const first = nodeSqliteFileDriver(FILE);
openDatabase(first.driver);
setDeviceId(first.driver, '11111111-1111-4111-8111-111111111111');
saveDraft(
  first.driver,
  TARGET,
  { score: 2, reasonCodes: ['audio_problem'], disclosureVersion: 'feedback-disclosure-1' },
  { now: NOW },
);
sendNow(first.driver, TARGET, { now: NOW, mutationId: MUTATION });
state(first.driver, 'after Send   ');

// 2. The process dies before any flush — the committed operation stays
// honestly 'pending', nothing reached the wire.
first.close();

// 3. Restart: the queue is due again; the server answers 503 once and the
// §5.4 backoff ladder (jittered per mutation id) schedules the retry.
const second = nodeSqliteFileDriver(FILE);
openDatabase(second.driver);
let clock = NOW + 60_000;
let calls = 0;
const sync = createFeedbackSync({
  driver: second.driver,
  secretStore: {
    getSecret: async () => 'synthetic-device-secret-fixture',
    saveSecret: async () => {},
    clearSecret: async () => {},
  },
  baseUrl: 'https://functions.example.invalid/functions/v1',
  transport: {
    put: async () => {
      calls++;
      if (calls === 1) return { status: 503, body: { error: 'feedback_unavailable' } };
      return { status: 200, body: { revision: 1, saved: true } };
    },
    deleteFeedback: async () => ({ status: 200, body: { revision: 1, deleted: true } }),
    read: async () => ({ status: 200, body: { revision: 0, score: null, reason_codes: [], deleted: false } }),
  },
  now: () => clock,
  makeMutationId: () => '00000000-0000-4000-8000-000000000002',
});
const firstFlush = await sync.flush();
console.log(`first flush  : dispatched=${firstFlush.dispatched} acknowledged=${firstFlush.acknowledged} requeued=${firstFlush.requeued}`);
state(second.driver, 'after 503    ');

// 4. The backoff window elapses: the same mutation id is retried and the
// acknowledgement lands — exactly one server record, one honest state.
clock = NOW + 120_000;
const secondFlush = await sync.flush();
console.log(`second flush : dispatched=${secondFlush.dispatched} acknowledged=${secondFlush.acknowledged} requeued=${secondFlush.requeued}`);
state(second.driver, 'after ACK    ');
second.close();

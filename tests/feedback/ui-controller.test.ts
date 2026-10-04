// G16.03 (issue #74) — the voluntary rating UI's controller suite: the
// invitation gating (once per session, only after local guide use), the
// no-preselected-star form, the kind-closed reasons, the explicit Send with
// its disclosure version, the honest delivery states over the real G16.02
// queue (a scripted transport, the production repository and sync) and the
// analytics separation (the wired events port never records a feedback
// round). Behavioral and revert-sensitive: removing any guarded rule below
// turns its named case red.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createFeedbackSync } from '../../services/feedbackSync.ts';
import type { FeedbackTransportResponse } from '../../services/feedbackSync.ts';
import * as feedbackRepository from '../../services/feedbackRepository.ts';
import { formatTargetKey, type FeedbackTarget } from '../../services/feedbackRepository.ts';
import { createServices } from '../../controllers/createServices.ts';
import type { TelemetryPort } from '../../controllers/commerce/commerceController.ts';
import type { ControllerStore } from '../../controllers/createControllerStore.ts';
import {
  createFeedbackController,
  deliveryOfView,
  FEEDBACK_DISCLOSURE_VERSION,
  reasonsFor,
  type FeedbackUiState,
} from '../../controllers/useFeedbackController.ts';
import {
  deferred,
  err409,
  GUIDE_TARGET,
  GUIDE_WIRE,
  M1,
  NOW,
  okDelete,
  okPut,
  okRead,
  openIdentifiedStore,
  openQueueStore,
  rawLocal,
  scriptedTransport,
  secretBox,
} from './queue-fixture.ts';

const PLACE_TARGET: FeedbackTarget = { kind: 'place', id: 'place-a1', version: '1', locale: 'be' };

type Controller = ControllerStore<FeedbackUiState>;

interface World {
  controller: Controller;
  transport: ReturnType<typeof scriptedTransport>;
}

function makeWorld(
  answer: (call: {
    op: 'put' | 'delete' | 'read';
    index: number;
  }) => FeedbackTransportResponse | Promise<FeedbackTransportResponse>,
): World {
  const driver = openIdentifiedStore();
  const transport = scriptedTransport(({ op, index }) => answer({ op, index }));
  const sync = createFeedbackSync({
    driver,
    secretStore: secretBox('secret-a'),
    baseUrl: 'https://functions.example.co/functions/v1',
    transport,
    now: () => NOW,
    makeMutationId: () => M1,
  });
  return { controller: createFeedbackController({ driver, sync, repository: feedbackRepository, now: () => NOW, makeMutationId: () => M1 }), transport };
}

// An identified world whose transport must never be called: for the
// scenarios that assert local-only behavior (no wire, no stored rows).
function idleWorld(): { driver: ReturnType<typeof openIdentifiedStore>; controller: Controller; transport: ReturnType<typeof scriptedTransport> } {
  const driver = openIdentifiedStore();
  const transport = scriptedTransport(() => err503Never());
  const sync = createFeedbackSync({
    driver,
    secretStore: secretBox('secret-a'),
    baseUrl: 'https://functions.example.co/functions/v1',
    transport,
    now: () => NOW,
  });
  return {
    driver,
    transport,
    controller: createFeedbackController({ driver, sync, repository: feedbackRepository, now: () => NOW, makeMutationId: () => M1 }),
  };
}

const lastForm = (controller: Controller) => {
  const form = controller.getState().form;
  assert.equal(form.kind, 'open', 'the form must be open');
  return form;
};

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

describe('G16.03 — the End invitation (20 §7, task step 2)', () => {
  test('only local guide use invites, and the target is the session own pinned identity', () => {
    const { controller } = makeWorld(() => err503Never());
    controller.getState().offerEndInvitation({
      sessionId: 's1',
      routeId: 'guide-route-a1',
      version: '1',
      locale: 'be',
      heardCount: 0,
    });
    assert.equal(controller.getState().invitation, null, 'zero heard stories is no use to rate');
    controller.getState().offerEndInvitation({
      sessionId: 's1',
      routeId: 'guide-route-a1',
      version: '1',
      locale: 'be',
      heardCount: 2,
    });
    assert.deepEqual(controller.getState().invitation, {
      sessionId: 's1',
      target: GUIDE_TARGET,
    });
  });

  test('at most once per session: a dismissed session is never offered again', () => {
    const { controller } = makeWorld(() => err503Never());
    const offer = (sessionId: string) =>
      controller.getState().offerEndInvitation({
        sessionId,
        routeId: 'guide-route-a1',
        version: '1',
        locale: 'be',
        heardCount: 1,
      });
    offer('s1');
    assert.notEqual(controller.getState().invitation, null);
    controller.getState().dismissInvitation();
    assert.equal(controller.getState().invitation, null);
    offer('s1');
    assert.equal(controller.getState().invitation, null, 'the second offer for the same session is a no-op');
    offer('s2');
    assert.equal(controller.getState().invitation?.sessionId, 's2', 'a different session invites again');
  });
});

describe('G16.03 — the form opens honestly (task step 1, acceptance 1)', () => {
  test('no preselected star and dismissal writes nothing', () => {
    const { driver, controller } = idleWorld();
    controller.getState().openForm(GUIDE_TARGET);
    assert.equal(lastForm(controller).score, null, 'no default value (20 §7)');
    assert.equal(lastForm(controller).delivery.kind, 'none');
    controller.getState().closeForm();
    assert.equal(controller.getState().invitation, null);
    // Fully optional: opening and closing a form (and dismissing an
    // invitation) never creates a stored row.
    assert.equal(rawLocal(driver, GUIDE_TARGET), undefined);
  });

  test('an edit preselects the person own previous choice, never a default', async () => {
    const { controller } = makeWorld(({ op }) => (op === 'put' ? okPut(1) : err503Never()));
    controller.getState().openForm(GUIDE_TARGET);
    controller.getState().setScore(4);
    await controller.getState().send();
    controller.getState().closeForm();
    controller.getState().openForm(GUIDE_TARGET);
    assert.equal(lastForm(controller).score, 4, 'the acknowledged score comes back');
  });

  test('route params are untrusted input: a corrupt triple answers null', () => {
    const { controller } = makeWorld(() => err503Never());
    const parse = (input: { kind?: string; id?: string; version?: string; locale?: string }) =>
      controller.getState().parseTarget(input);
    assert.equal(parse({ kind: 'guide', id: 'r', version: '1', locale: 'be' })?.id, 'r');
    assert.equal(parse({ kind: 'collection', id: 'r', version: '1', locale: 'be' }), null);
    assert.equal(parse({ kind: 'guide', id: 'r', version: 'v1', locale: 'be' }), null);
    assert.equal(parse({ kind: 'guide', id: '', version: '1', locale: 'be' }), null);
    assert.equal(parse({ kind: 'guide', id: 'r', version: '1', locale: 'нэ-літары' }), null);
  });
});

describe('G16.03 — the closed kind reasons (task step 2, acceptance 3)', () => {
  test('the guide form offers audio_problem; the place form refuses it by name', () => {
    assert.ok(reasonsFor('guide').includes('audio_problem'));
    assert.ok(!reasonsFor('place').includes('audio_problem'));
    const { controller } = makeWorld(() => err503Never());
    controller.getState().openForm(PLACE_TARGET);
    assert.throws(
      () => controller.getState().toggleReason('audio_problem'),
      (error: unknown) =>
        error instanceof Error && error.message.includes('audio_problem') && error.message.includes('place'),
    );
    controller.getState().openForm(GUIDE_TARGET);
    controller.getState().toggleReason('audio_problem');
    assert.deepEqual(lastForm(controller).reasons, ['audio_problem']);
  });

  test('at most three unique reasons; a second tap untoggles', () => {
    const { controller } = makeWorld(() => err503Never());
    controller.getState().openForm(GUIDE_TARGET);
    const actions = controller.getState();
    actions.toggleReason('interesting_stories');
    actions.toggleReason('too_long');
    actions.toggleReason('clear_delivery');
    assert.throws(
      () => actions.toggleReason('audio_problem'),
      (error: unknown) => error instanceof Error && error.message.includes('at most 3'),
    );
    actions.toggleReason('too_long');
    assert.deepEqual(lastForm(controller).reasons, ['interesting_stories', 'clear_delivery']);
  });
});

describe('G16.03 — the explicit Send and the delivery states (task steps 3–4)', () => {
  test('send without a star is a named refusal and stores nothing', async () => {
    const { driver, controller, transport } = idleWorld();
    controller.getState().openForm(GUIDE_TARGET);
    await assert.rejects(
      () => controller.getState().send(),
      (error: unknown) => error instanceof Error && error.message.includes('no score chosen'),
    );
    assert.equal(transport.calls.length, 0);
    assert.equal(rawLocal(driver, GUIDE_TARGET), undefined);
  });

  test('the put carries the bound session target, the closed reasons and the pinned disclosure version', async () => {
    const { controller, transport } = makeWorld(({ op }) => (op === 'put' ? okPut(1) : err503Never()));
    controller.getState().openForm(GUIDE_TARGET);
    controller.getState().setScore(2);
    controller.getState().toggleReason('audio_problem');
    await controller.getState().send();
    assert.equal(transport.calls.length, 1);
    assert.deepEqual(transport.calls[0]?.body, {
      mutation_id: M1,
      target: GUIDE_WIRE,
      expected_revision: 0,
      score: 2,
      reason_codes: ['audio_problem'],
      disclosure_version: FEEDBACK_DISCLOSURE_VERSION,
    });
    assert.equal(FEEDBACK_DISCLOSURE_VERSION, 'feedback-disclosure-1');
    assert.deepEqual(lastForm(controller).delivery, { kind: 'sent', score: 2 });
  });

  test('offline: the state stays honestly pending (saved on the device is not sent)', async () => {
    const { controller } = makeWorld(() => {
      throw new TypeError('network unreachable');
    });
    controller.getState().openForm(GUIDE_TARGET);
    controller.getState().setScore(3);
    await controller.getState().send();
    assert.deepEqual(lastForm(controller).delivery, { kind: 'pending', deletePending: false });
    assert.equal(lastForm(controller).error, null, 'a transient transport failure is the pending state, not a diagnostic');
  });

  test('a 409 shows the conflict state; the own-state read resolves it and the send lands on the actual revision', async () => {
    let puts = 0;
    const { controller, transport } = makeWorld(({ op }) => {
      if (op === 'put') {
        puts += 1;
        return puts === 1 ? err409() : okPut(2);
      }
      if (op === 'read') return okRead(1, 4, false);
      return err503Never();
    });
    controller.getState().openForm(GUIDE_TARGET);
    controller.getState().setScore(4);
    await controller.getState().send();
    assert.deepEqual(lastForm(controller).delivery, { kind: 'conflict' });
    await controller.getState().resolveConflict();
    assert.deepEqual(lastForm(controller).delivery, { kind: 'sent', score: 4 }, 'the read stores the server truth');
    // The same value re-sent against the actual revision 1 — now accepted.
    await controller.getState().send();
    const putCalls = transport.calls.filter((call) => call.op === 'put');
    assert.equal((putCalls.at(-1)?.body as { expected_revision: number }).expected_revision, 1);
    assert.deepEqual(lastForm(controller).delivery, { kind: 'sent', score: 4 });
  });

  test('delete: a queued tombstone renders the delete-pending state, then the acknowledged deletion', async () => {
    const deferredDelete = deferred<FeedbackTransportResponse>();
    const { controller, transport } = makeWorld(({ op, index }) => {
      if (op === 'put') return okPut(1);
      return index === 1 ? deferredDelete.promise : okDelete(2);
    });
    controller.getState().openForm(GUIDE_TARGET);
    controller.getState().setScore(5);
    await controller.getState().send();
    assert.deepEqual(lastForm(controller).delivery, { kind: 'sent', score: 5 });
    const removing = controller.getState().remove();
    await settle();
    // The CAS-delete is in flight: the word state is «выдаленне чакае сеткі».
    assert.deepEqual(lastForm(controller).delivery, { kind: 'pending', deletePending: true });
    deferredDelete.resolve(okDelete(2));
    await removing;
    assert.deepEqual(lastForm(controller).delivery, { kind: 'sent', score: null }, 'the acknowledged tombstone: no score');
    assert.ok(transport.calls.some((call) => call.op === 'delete'), 'the tombstone reached the transport');
  });
});

describe('G16.03 — the own list and the wiring (task step 4, acceptance 4)', () => {
  test('refreshItems lists the own rows with their store views', async () => {
    const { controller } = makeWorld(({ op }) => (op === 'put' ? okPut(1) : err503Never()));
    controller.getState().openForm(GUIDE_TARGET);
    controller.getState().setScore(4);
    await controller.getState().send();
    controller.getState().refreshItems();
    const items = controller.getState().items;
    assert.equal(items.length, 1);
    assert.equal(formatTargetKey(items[0]!.target), formatTargetKey(GUIDE_TARGET));
    assert.deepEqual(deliveryOfView(items[0]), { kind: 'sent', score: 4 });
  });

  test('analytics denied: the wired events port records nothing during a full feedback round', async () => {
    const eventCalls: unknown[] = [];
    const events: TelemetryPort = { record: (event) => eventCalls.push(event) };
    const driver = openIdentifiedStore();
    const transport = scriptedTransport(({ op }) => (op === 'put' ? okPut(1) : err503Never()));
    const sync = createFeedbackSync({
      driver,
      secretStore: secretBox('secret-a'),
      baseUrl: 'https://functions.example.co/functions/v1',
      transport,
      now: () => NOW,
      makeMutationId: () => M1,
    });
    const services = createServices({ feedback: { driver, sync }, events });
    const controller = services.feedback?.controller;
    assert.ok(controller, 'the feedback member exists with its ports');
    controller.getState().openForm(GUIDE_TARGET);
    controller.getState().setScore(3);
    await controller.getState().send();
    assert.equal(transport.calls.length, 1, 'the feedback reached the feedback transport');
    assert.deepEqual(eventCalls, [], 'no events ride a feedback round (acceptance 4)');
    assert.equal(controller.getState().items.length, 1, 'the own list sees the sent rating');
  });
});

describe('G16.03 — an unidentified store is honest, not broken', () => {
  test('the send queues locally and the flush skips the round without identity', async () => {
    const driver = openQueueStore();
    const transport = scriptedTransport(() => err503Never());
    const sync = createFeedbackSync({
      driver,
      secretStore: secretBox(null),
      baseUrl: 'https://functions.example.co/functions/v1',
      transport,
      now: () => NOW,
    });
    const controller = createFeedbackController({ driver, sync, repository: feedbackRepository, now: () => NOW, makeMutationId: () => M1 });
    controller.getState().openForm(GUIDE_TARGET);
    controller.getState().setScore(4);
    await controller.getState().send();
    assert.deepEqual(lastForm(controller).delivery, { kind: 'pending', deletePending: false });
    assert.equal(transport.calls.length, 0, 'no network without identity (21 §6)');
    assert.ok(rawLocal(driver, GUIDE_TARGET), 'the draft stays on the device');
  });
});

// The named refusal used by every scenario that must never reach the wire
// (an unscripted transport call is a test bug, not a state).
function err503Never(): never {
  throw new Error('unscripted transport call');
}

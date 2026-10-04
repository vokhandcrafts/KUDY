// G16.03 — the Showboat scenario script (the voluntary rating UI's honest
// lifecycle, issue #74): the End invitation's once-per-session gate, the
// no-preselected-star form, the explicit Send through the real G16.02 queue,
// the offline round's honest pending state, the acked edit and the
// delete-pending tombstone. The transport is scripted and the clock is fixed
// — the trace is deterministic. Test-only module; imported by
// docs/demos/2026-10-04-g1603-rating-ui.md, never by production code.
import { createFeedbackSync } from '../../services/feedbackSync.ts';
import type { FeedbackTransportResponse } from '../../services/feedbackSync.ts';
import * as feedbackRepository from '../../services/feedbackRepository.ts';
import {
  createFeedbackController,
  FEEDBACK_DISCLOSURE_VERSION,
  type FeedbackUiState,
} from '../../controllers/useFeedbackController.ts';
import type { ControllerStore } from '../../controllers/createControllerStore.ts';
import {
  deferred,
  GUIDE_TARGET,
  M1,
  NOW,
  okDelete,
  okPut,
  openIdentifiedStore,
  scriptedTransport,
  secretBox,
} from './queue-fixture.ts';

function summary(controller: ControllerStore<FeedbackUiState>): string {
  const state = controller.getState();
  const form = state.form;
  if (form.kind !== 'open') return 'form=closed';
  const stored = state.items[0];
  return [
    `score=${String(form.score)}`,
    `reasons=${form.reasons.join('|') || '—'}`,
    `delivery=${JSON.stringify(form.delivery)}`,
    stored !== undefined
      ? `stored={"state":"${stored.state}","revision":${stored.revision},"score":${String(stored.score)}}`
      : 'stored=none',
  ].join(' ');
}

function controllerOver(sync: ReturnType<typeof createFeedbackSync>): ControllerStore<FeedbackUiState> {
  return createFeedbackController({
    driver: openIdentifiedStore(),
    sync,
    repository: feedbackRepository,
    now: () => NOW,
    makeMutationId: () => M1,
  });
}

async function main(): Promise<void> {
  // The End invitation (20 §7): only local guide use, once per session.
  {
    const driver = openIdentifiedStore();
    const sync = createFeedbackSync({
      driver,
      secretStore: secretBox('secret-a'),
      baseUrl: 'https://functions.example.co/functions/v1',
      transport: scriptedTransport(() => okPut(1)),
      now: () => NOW,
    });
    const controller = createFeedbackController({ driver, sync, repository: feedbackRepository, now: () => NOW, makeMutationId: () => M1 });
    controller.getState().offerEndInvitation({ sessionId: 'walk-demo', routeId: GUIDE_TARGET.id, version: '1', locale: 'be', heardCount: 0 });
    console.log(`zero heard : invitation=${String(controller.getState().invitation !== null)}`);
    controller.getState().offerEndInvitation({ sessionId: 'walk-demo', routeId: GUIDE_TARGET.id, version: '1', locale: 'be', heardCount: 2 });
    console.log(`after walk : invitation=${String(controller.getState().invitation !== null)} target=${JSON.stringify(controller.getState().invitation?.target)}`);
    controller.getState().dismissInvitation();
    controller.getState().offerEndInvitation({ sessionId: 'walk-demo', routeId: GUIDE_TARGET.id, version: '1', locale: 'be', heardCount: 2 });
    console.log(`re-offered : invitation=${String(controller.getState().invitation !== null)} (once per session)`);
  }

  // The offline round: the explicit Send queues honestly — saved on the
  // device is not sent (the transport rejects every put).
  {
    const driver = openIdentifiedStore();
    const sync = createFeedbackSync({
      driver,
      secretStore: secretBox('secret-a'),
      baseUrl: 'https://functions.example.co/functions/v1',
      transport: scriptedTransport(() => {
        throw new TypeError('network unreachable');
      }),
      now: () => NOW,
    });
    const controller = createFeedbackController({ driver, sync, repository: feedbackRepository, now: () => NOW, makeMutationId: () => M1 });
    controller.getState().openForm(GUIDE_TARGET);
    console.log(`opened     : ${summary(controller)}`);
    controller.getState().setScore(2);
    controller.getState().toggleReason('audio_problem');
    console.log(`picked     : ${summary(controller)}`);
    await controller.getState().send();
    console.log(`offline    : ${summary(controller)}`);
  }

  // The online lifecycle: acked send, the acked edit against revision 1,
  // then the delete whose tombstone waits for the network.
  {
    const deferredDelete = deferred<FeedbackTransportResponse>();
    let puts = 0;
    const driver = openIdentifiedStore();
    const sync = createFeedbackSync({
      driver,
      secretStore: secretBox('secret-a'),
      baseUrl: 'https://functions.example.co/functions/v1',
      transport: scriptedTransport(({ op, index }) => {
        if (op === 'put') {
          puts += 1;
          return okPut(puts);
        }
        return index === 2 ? deferredDelete.promise : okDelete(3);
      }),
      now: () => NOW,
    });
    const controller = createFeedbackController({ driver, sync, repository: feedbackRepository, now: () => NOW, makeMutationId: () => M1 });
    controller.getState().openForm(GUIDE_TARGET);
    controller.getState().setScore(2);
    controller.getState().toggleReason('audio_problem');
    await controller.getState().send();
    console.log(`acked      : ${summary(controller)} disclosure=${FEEDBACK_DISCLOSURE_VERSION}`);
    // The acked edit: the same form, the new desired value, sent against the
    // acknowledged revision (20 §7: змяненне замяняе ацэнку).
    controller.getState().setScore(4);
    await controller.getState().send();
    console.log(`edited     : ${summary(controller)}`);
    const removing = controller.getState().remove();
    await new Promise((resolve) => setTimeout(resolve, 5));
    console.log(`deleting   : ${summary(controller)}`);
    deferredDelete.resolve(okDelete(3));
    await removing;
    console.log(`deleted    : ${summary(controller)}`);
  }
}

void main();

// G06.03 (issue #279) — Showboat driver (the run panel): the pure ladder of
// 11 §2/§6 — Peek → Half → Full, one shared close step for ✕ and Back, the
// last inspected card kept — and the story-facts read that feeds the card's
// transcript. The full stack (the bar with the audible audio's progress, the
// «Зараз грае» row, zero audio commands across panel changes, the durable
// session across exit) is the suites' path; the inputs here are fixed and
// deterministic — no clocks, no randomness.
import { initialPanelState, panelClosed, panelOpened, panelRaised } from './runPanel.ts';
import { readRunStoryFacts } from '../../services/contentRepo/runStoryFacts.ts';

// The pinned layer's story facts over an in-memory store — the same seam
// the device adapter implements.
const store = {
  listDir: async () => null,
  readFile: async (rel) =>
    rel === 'be/base/stops.json'
      ? {
          kind: 'present',
          bytes: new TextEncoder().encode(
            JSON.stringify([
              { story_id: 'story-1', transcript: 'Транскрыпт мытні' },
              { story_id: 'story-2', transcript: 'Транскрыпт порта' },
            ]),
          ),
        }
      : { kind: 'absent' },
  statSize: async () => null,
};

const facts = await readRunStoryFacts(store, 'be/base');
const transcriptOf = (stopId) => {
  if (!facts.ok) return null;
  const storyId = stopId === 'stop-1' ? 'story-1' : 'story-2';
  return facts.stories.find((story) => story.storyId === storyId)?.transcript ?? null;
};

let panel = initialPanelState;
const show = (label) => console.log(`${label}: position=${panel.position} inspected=${panel.inspected ?? '—'}`);

show('peek');
panel = panelOpened(panel, 'stop-1');
show('tap stop-1 (Half)');
panel = panelRaised(panel);
show('expand (Full)');
console.log(`card transcript (inspected stop-1): ${transcriptOf('stop-1')}`);
panel = panelClosed(panel);
show('✕ (Half, inspected kept)');
panel = panelClosed(panel);
show('Back (Peek, inspected kept)');
panel = panelOpened(panel, 'stop-2');
show('tap stop-2 (Half)');
console.log(`card transcript (inspected stop-2): ${transcriptOf('stop-2')}`);

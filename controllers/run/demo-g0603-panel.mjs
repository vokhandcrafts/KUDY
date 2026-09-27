// G06.03 (issue #279) — Showboat driver (the run panel): the pure ladder of
// 11 §2/§6 — Peek → Half → Full, one shared close step for ✕ and Back, the
// last inspected card kept. The full stack (the bar with the audible audio's
// progress, the «Зараз грае» row, the card's transcript from the pinned
// layer's stops.json, zero audio commands across panel changes, the durable
// session across exit) is the suites' path — `app/run.test.tsx` under jest,
// `controllers/run/runPanel.test.ts` and
// `services/contentRepo/runStoryFacts.test.ts` under node --test. The inputs
// here are fixed and deterministic — no clocks, no randomness.
import { initialPanelState, panelClosed, panelOpened, panelRaised } from './runPanel.ts';

let panel = initialPanelState;
const show = (label) => console.log(`${label}: position=${panel.position} inspected=${panel.inspected ?? '—'}`);

show('peek');
panel = panelOpened(panel, 'stop-1');
show('tap stop-1 (Half)');
panel = panelRaised(panel);
show('expand (Full)');
panel = panelClosed(panel);
show('✕ (Half, inspected kept)');
panel = panelClosed(panel);
show('Back (Peek, inspected kept)');
panel = panelOpened(panel, 'stop-2');
show('tap stop-2 (Half)');
panel = panelRaised(panel);
show('expand (Full, new card)');
panel = panelClosed(panel);
panel = panelClosed(panel);
show('✕ ×2 (Peek, inspected kept)');

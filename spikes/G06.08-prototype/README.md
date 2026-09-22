# G06.08 interactive prototype and UI-agent package

Issue #61 (G06.08 — «Інтэрактыўны пратотып і пакет для UI-агентаў»). A static,
zero-dependency prototype you can walk through: Start → manual Play → pause →
upgrade → return from a Moment → other-guide hint (R07) → End, plus the
discovery (D01–D07), feedback (F01–F04) and language (L01–L02) scenarios of
`docs/20_discovery_and_feedback.md` §11.

## What is normative here — and what is not

- Walk-session state is **computed by the normative model**
  `docs/run-model/run-model.mjs` (`start/step/status/missed`). This prototype
  does not re-implement engine semantics anywhere.
- Discovery results are **computed by the real selector**
  `core/discovery/selectDiscovery.ts` over the accepted fixture copy at prepare
  time. The UI only renders prepared outcomes.
- Screen/state specs for production UI agents live in `package/screens.md`;
  the row-by-row tie-in is `package/package-map.md`.
- Visual values (colors, spacing, fonts) are a **marked-draft palette** in
  `prototype/styles.css`, explicitly superseded by G06.06/G06.07 — those tasks
  own the single source of design values.
- All data is synthetic; nothing here is published content or a content source.
- The founder approval gate (criterion 3) is a human review of the PR.

## Run

Node 22+ only; no install step.

```sh
cd spikes/G06.08-prototype
npm run prepare    # regenerates data/selection-outcomes.json (gitignored)
npm run serve      # http://127.0.0.1:4174/spikes/G06.08-prototype/prototype/
npm test           # guards: fixture copy identity, walkthrough chain, server containment
npm run walkthrough  # deterministic headless printout of the same contracts
```

Open the printed URL. Module imports do not work over `file://`, so use the
server. The demo toggles (GPS denied, offline, empty city, big text) live on
the My KUDY screen and are labeled «толькі пратотып».

## Layout

- `prototype/index.html` + `app.js` + `styles.css` — the interactive surface;
  `app.js` imports the model from `/docs/run-model/run-model.mjs`.
- `prototype/walkthrough.mjs` — deterministic scenario runner (also the
  Showboat demo source); exports `runWalk`, `runDiscovery`, `runFeedback`.
- `data/synthetic-city.json` — Run-side world (guides/stops/stories/moments);
  `data/discovery-index.json` — verbatim copy of the accepted fixture (guarded
  by a test against the canonical file); `data/selection-outcomes.json` —
  generated, gitignored.
- `scripts/serve.mjs` — static server over the shared `tools/serve-static.mjs`;
  `scripts/prepare-data.mjs` — computes the selector outcomes.
- `test/prototype.test.mjs` — fail-on-revert guards (wired into the root
  `npm test`).

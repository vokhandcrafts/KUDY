# G00.02.a offline-map spike

Zero-dependency option-C experiment: a tiny, route-scoped map package is copied from an immutable source into staging, verified against `lock.json`, then atomically activated. It is a browser diagnostic, not a MapLibre Native or production map.

## Fixed input

- bbox: `18.6460,54.3470,18.6570,54.3540` (a small central-Gdańsk sample, not the whole city)
- zoom: `14–16`
- source/date: synthetic geometry authored for this spike on `2026-09-09`; place/street names are only diagnostic labels and are not an OSM extract
- data licence declaration: `ODbL-1.0-compatible attribution demonstration`; no public OSM tile server is contacted
- code: repository-owned spike code; no copied reference-project code

## Install, prepare, run

No install or network access is needed; Node 22+ is the only dependency.

```sh
cd spikes/G00.02-offline-map
npm ci --offline
npm run reset-test-data
npm run prepare-data
npm test
npm run serve
```

Open `http://127.0.0.1:4173`. After it first renders, stop the server, restart it with `npm run serve`, and reload the page: the active package is read from disk. The map supports drag/pan and the `+`/`−` controls for zoom 14–16. The blue circle is a playable stop, the grey lock is locked content, and the orange diamond is a non-story POI. Attribution is visible and clickable.

## Reset only this spike's generated data

```sh
npm run reset-test-data
```

This removes only `runtime/` below this directory. Source fixtures remain unchanged.

## Failure checks

`npm test` checks the happy path plus interrupted staging, insufficient declared capacity, a deleted style resource, tampering, reload, out-of-bbox handling, and preservation of a previously ready package. The test is evidence for package mechanics and browser-loadable local assets only. It does not prove MapLibre Native, OS airplane mode, iOS, Android, storage APIs, or performance on a phone.

## A/B/C support comparison constrained to checkout evidence

| Option | Checkout-supported fact | Experiment decision |
|---|---|---|
| A — MapLibre offline manager | The architecture records it as MapLibre's native route, requiring owned/licensed hosting and device checks for update/quota behavior. | Not implemented: no native SDK, host, account, or device is available offline. |
| B — packaged MBTiles/PMTiles | The architecture records that MapLibre Native does not read PMTiles without an adapter. | Not implemented: adding and verifying a reader requires unavailable native dependencies/device builds. |
| C — tiles/assets in each guide package | The architecture records smaller downloads but duplicate tiles between guides. | Selected to test deterministic package completeness and atomic readiness with no external service. |

These are facts already recorded from official-source research in `docs/architecture/08_stack_and_reference_projects.md`, `09_technical_architecture.md`, and `10_research_log.md`. The issue forbids new network access, so this spike does not claim a fresh upstream verification on 2026-09-09. Cost is likewise **not verified**, not “free”: option C still has generation, storage, hosting, and duplicated-download costs.

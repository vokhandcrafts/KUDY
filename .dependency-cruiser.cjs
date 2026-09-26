// Machine projection of the layer matrix from the canonical sources:
// docs/architecture/09_technical_architecture.md §6 and
// docs/architecture/19_class_and_module_map.md §2 + §4.2 (task G18.01, issue #164).
// The canon owns the rules; this file only projects them — drift between the
// config and the canon is a review defect (implementation-rules §2). Run via
// `npm run arch:check`; existing violations live in tools/arch/baseline.json,
// policy and per-entry explanations in tools/arch/README.md.
'use strict';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // core/ (production files): may import relative files inside core/ only —
    // nothing outside core/, plus no node:*, no react-native/expo, no npm
    // packages. node:* imports resolve to a dependency path outside core/, so
    // one path rule covers zones, node builtins and packages alike.
    {
      name: 'core-zone-closed',
      comment: 'core/ production files import only relative files inside core/ (09 §6, 19 §2.1)',
      severity: 'error',
      from: { path: '^core/', pathNot: '\\.test\\.[cm]?[jt]sx?$' },
      to: { pathNot: '^core/' },
    },
    // Tests inside core/ are exempt for node:* (node:test, node:assert, fixture
    // file access), but still may not pull npm packages or other zones.
    {
      name: 'core-test-no-npm',
      comment: 'core/ tests take no npm packages (matrix core row: tests exempt for node:* only)',
      severity: 'error',
      from: { path: '^core/.*\\.test\\.[cm]?[jt]sx?$' },
      to: { dependencyTypes: ['npm'] },
    },
    {
      name: 'core-test-no-zones',
      comment: 'core/ tests import no other zone (matrix core row: tests exempt for node:* only)',
      severity: 'error',
      from: { path: '^core/.*\\.test\\.[cm]?[jt]sx?$' },
      to: { path: '^(services|web|tools|spikes|app|controllers)/' },
    },
    // services/ is the OS/network/disk boundary: node:*, core/, contracts/ and
    // relative imports are fine; UI and tooling zones are not.
    {
      name: 'services-zone-closed',
      comment: 'services/ must not import web/, tools/, spikes/, app/, controllers/ (matrix services row)',
      severity: 'error',
      from: { path: '^services/' },
      to: { path: '^(web|tools|spikes|app|controllers)/' },
    },
    // contracts/ is the shared schema zone: relative imports only, no app zone.
    {
      name: 'contracts-zone-closed',
      comment:
        'contracts/ must not import any app zone: core/, services/, web/, tools/, spikes/, app/, controllers/',
      severity: 'error',
      from: { path: '^contracts/' },
      to: { path: '^(core|services|web|tools|spikes|app|controllers)/' },
    },
    // web/ reads its own packages and contracts/; the app zones are off limits.
    {
      name: 'web-zone-closed',
      comment: 'web/ must not import core/, services/, tools/, spikes/, app/, controllers/ (matrix web row)',
      severity: 'error',
      from: { path: '^web/' },
      to: { path: '^(core|services|tools|spikes|app|controllers)/' },
    },
    // tools/ is a separate process with no shared code from the app (19 §2.4):
    // node:* and contracts/ only. The deliberate exception is tools/simulate
    // (G05.06.a): 09 §11 requires the simulator to import the production
    // functions it exercises — acceptFix, step, the run orchestrator and the
    // services they compose — so a simulator that re-implements logic tests
    // nothing. What simulate may import is pinned by its own rules below.
    {
      name: 'tools-zone-closed',
      comment: 'tools/ must not import core/, services/, web/, spikes/, app/, controllers/ (matrix tools row, 19 §2.4); tools/simulate is exempt — 09 §11 imports production modules',
      severity: 'error',
      from: { path: '^tools/', pathNot: '^tools/simulate/' },
      to: { path: '^(core|services|web|spikes|app|controllers)/' },
    },
    // tools/simulate (G05.06.a): the allowlist behind the tools-zone-closed
    // exemption. The simulator reaches only the run stack — core/, services/
    // and the run orchestrator — never the UI zones, never npm packages
    // (node:* builtins only), and never the frozen executable reference
    // docs/run-model (19 §7.2): a simulator that imports the documentation
    // model tests the model, not the app.
    {
      name: 'simulate-no-other-zones',
      comment: 'tools/simulate must not import web/, spikes/, app/ (09 §11: the simulator imports the run stack only, G05.06.a AC1)',
      severity: 'error',
      from: { path: '^tools/simulate/' },
      to: { path: '^(web|spikes|app)/' },
    },
    {
      name: 'simulate-run-controllers-only',
      comment: 'tools/simulate reaches controllers/run/ only — no other controllers (09 §11, G05.06.a AC1)',
      severity: 'error',
      from: { path: '^tools/simulate/' },
      to: { path: '^controllers/', pathNot: '^controllers/run/' },
    },
    {
      name: 'simulate-no-npm',
      comment: 'tools/simulate takes no npm packages — node:* builtins and the production modules only (09 §11 determinism, G05.06.a AC1)',
      severity: 'error',
      from: { path: '^tools/simulate/' },
      to: { dependencyTypes: ['npm'] },
    },
    {
      name: 'simulate-no-run-model',
      comment: 'tools/simulate must not import the frozen docs/run-model reference — it imports production modules (19 §7.2, G05.06.a AC1)',
      severity: 'error',
      from: { path: '^tools/simulate/' },
      to: { path: '^docs/run-model/' },
    },
    // UI screens reach state and effects only through controllers (19 §4.2
    // edge rule); introduced with the Expo Router skeleton (G06.09.a).
    {
      name: 'app-no-services',
      comment: 'app/ must not import services/ directly — controllers only (19 §4.2 edge rule)',
      severity: 'error',
      from: { path: '^app/' },
      to: { path: '^services/' },
    },
    // G06.09.b completes the app-side edge: screens import controllers/ only
    // (plus React/Expo) — core/ is reached through controllers as well.
    {
      name: 'app-no-core',
      comment: 'app/ must not import core/ directly — controllers only (19 §4.2 edge rule)',
      severity: 'error',
      from: { path: '^app/' },
      to: { path: '^core/' },
    },
    // Controllers consume services/ through explicit ports (issue #209 AC1):
    // the composition root (controllers/createServices.ts) is the only module
    // that value-imports and constructs them; every other controller takes
    // types only. Tests are exempt — they wire fakes.
    {
      name: 'controllers-services-type-only',
      comment:
        'controllers/ value-imports services/ only in the composition root; elsewhere type-only (19 §2.2, issue #209 AC1)',
      severity: 'error',
      from: {
        path: '^controllers/',
        pathNot: ['^controllers/createServices\\.ts$', '\\.test\\.[cm]?[jt]sx?$'],
      },
      to: { path: '^services/', dependencyTypesNot: ['type-only'] },
    },
    // Cycles are forbidden within and across all checked zones (19 §4.2).
    {
      name: 'no-cycles',
      comment: 'no circular dependencies within or across the checked zones (19 §4.2)',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    // The scan scope is the zone list passed on the command line (core services
    // contracts tools web — see the arch:check script). Excludes: installed
    // dependencies are reported but not followed; build outputs inside the
    // zones (web/.next, web/out, tools/build-bundle/build) are not modules.
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(\\.next|out|build)(/|$)' },
  },
};

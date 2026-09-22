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
      comment: 'contracts/ must not import any app zone: core/, services/, web/, tools/, spikes/',
      severity: 'error',
      from: { path: '^contracts/' },
      to: { path: '^(core|services|web|tools|spikes)/' },
    },
    // web/ reads its own packages and contracts/; the app zones are off limits.
    {
      name: 'web-zone-closed',
      comment: 'web/ must not import core/, services/, tools/, spikes/ (matrix web row)',
      severity: 'error',
      from: { path: '^web/' },
      to: { path: '^(core|services|tools|spikes)/' },
    },
    // tools/ is a separate process with no shared code from the app (19 §2.4):
    // node:* and contracts/ only.
    {
      name: 'tools-zone-closed',
      comment: 'tools/ must not import core/, services/, web/, spikes/ (matrix tools row, 19 §2.4)',
      severity: 'error',
      from: { path: '^tools/' },
      to: { path: '^(core|services|web|spikes)/' },
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

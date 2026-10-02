// Behavioral tests for the wire-types generation gate (G20.19, issue #490).
// They run the real generator CLI against the repo and against sandboxes:
// freshness of the committed output (the --check gate), byte-identical
// repeated generation, the wiring guard (package.json scripts and the
// npm-test glob — implementation-rules 1: configuration is code), and the
// two failure modes the specification demands: a changed schema or locale
// owner makes the check red until regeneration, and a schema that drifts
// from its canonical owner fails closed with a named diagnostic.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const GENERATOR = path.join(REPO_ROOT, 'tools', 'contracts', 'generate-wire-types.mjs');
const SCHEMAS = path.join(REPO_ROOT, 'contracts', 'schemas');
const COMMITTED = path.join(REPO_ROOT, 'contracts', 'wire', 'wire-types.ts');

const SCHEMA_FILES = ['localized-text.schema.json', 'catalog.schema.json', 'route.schema.json', 'stop.schema.json'];

function runGenerator(args) {
  const run = spawnSync(process.execPath, [GENERATOR, ...args], { encoding: 'utf8' });
  return { status: run.status, output: `${run.stdout}\n${run.stderr}` };
}

// A sandbox with copies of the four schema files, optionally mutated.
function makeSchemaSandbox(mutations) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-wire-'));
  for (const name of SCHEMA_FILES) fs.copyFileSync(path.join(SCHEMAS, name), path.join(dir, name));
  for (const mutate of mutations ?? []) {
    const file = path.join(dir, mutate.file);
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    mutate.apply(doc);
    fs.writeFileSync(file, JSON.stringify(doc, null, 2));
  }
  return dir;
}

function readCommitted() {
  return fs.readFileSync(COMMITTED, 'utf8');
}

test('wire-types wiring is guarded (package.json scripts, npm-test glob, committed output)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['contracts:wire'], /tools\/contracts\/generate-wire-types\.mjs/, 'contracts:wire must run the generator');
  assert.match(pkg.scripts['contracts:wire:check'], /tools\/contracts\/generate-wire-types\.mjs/, 'contracts:wire:check must run the generator');
  assert.match(pkg.scripts['contracts:wire:check'], /--check/, 'contracts:wire:check must pass --check');
  assert.match(pkg.scripts.test, /"?tools\/contracts\/\*\.test\.mjs"?/, 'npm test glob must include tools/contracts tests');
  assert.ok(fs.existsSync(GENERATOR), 'the generator must exist');
  assert.ok(fs.existsSync(COMMITTED), 'the committed wire-types output must exist');
});

test('committed wire-types output is fresh (--check passes on HEAD)', () => {
  const { status, output } = runGenerator(['--check']);
  assert.equal(status, 0, `expected exit 0:\n${output}`);
  assert.match(output, /wire-types: OK/);
});

test('repeated generation is byte-identical to the committed output', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-wire-'));
  const first = path.join(dir, 'first.ts');
  const second = path.join(dir, 'second.ts');
  for (const out of [first, second]) {
    const { status, output } = runGenerator(['--out', out]);
    assert.equal(status, 0, `generation failed:\n${output}`);
  }
  assert.equal(fs.readFileSync(first, 'utf8'), fs.readFileSync(second, 'utf8'), 'two runs must agree');
  assert.equal(fs.readFileSync(first, 'utf8'), readCommitted(), 'generation must reproduce the committed file');
});

test('a locale-allowlist change fails the check until regeneration (owner: localized-text)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-wire-'));
  const out = path.join(dir, 'wire-types.ts');
  fs.copyFileSync(COMMITTED, out);

  // The owner and its catalog mirror move together — the compatible-change
  // scenario; the owner-only divergence is the separate fails-closed test.
  const sandbox = makeSchemaSandbox([
    {
      file: 'localized-text.schema.json',
      apply: (doc) => doc.propertyNames.enum.push('pl'),
    },
    {
      file: 'catalog.schema.json',
      apply: (doc) => doc.properties.routes.items.properties.locales.items.enum.push('pl'),
    },
  ]);
  const stale = runGenerator(['--check', '--schemas', sandbox, '--out', out]);
  assert.notEqual(stale.status, 0, `the check must fail on a changed locale owner:\n${stale.output}`);
  assert.match(stale.output, /stale output/, 'the diagnostic must name the staleness');

  const regenerated = runGenerator(['--schemas', sandbox, '--out', out]);
  assert.equal(regenerated.status, 0, `regeneration must succeed:\n${regenerated.output}`);
  assert.match(fs.readFileSync(out, 'utf8'), /'pl'/, 'the regenerated list must be derived from the owner');
  const fresh = runGenerator(['--check', '--schemas', sandbox, '--out', out]);
  assert.equal(fresh.status, 0, `the check must pass after regeneration:\n${fresh.output}`);
});

test('a catalog-schema field change fails the check until regeneration', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-wire-'));
  const out = path.join(dir, 'wire-types.ts');
  fs.copyFileSync(COMMITTED, out);

  const sandbox = makeSchemaSandbox([
    {
      file: 'catalog.schema.json',
      apply: (doc) => delete doc.properties.routes.items.properties.product_id,
    },
  ]);
  const stale = runGenerator(['--check', '--schemas', sandbox, '--out', out]);
  assert.notEqual(stale.status, 0, `the check must fail on a changed schema:\n${stale.output}`);
  assert.match(stale.output, /stale output/, 'the diagnostic must name the staleness');

  const regenerated = runGenerator(['--schemas', sandbox, '--out', out]);
  assert.equal(regenerated.status, 0, `regeneration must succeed:\n${regenerated.output}`);
  assert.doesNotMatch(fs.readFileSync(out, 'utf8'), /\n  product_id\?: string;/, 'the dropped field must leave the route-entry projection');
  const fresh = runGenerator(['--check', '--schemas', sandbox, '--out', out]);
  assert.equal(fresh.status, 0, `the check must pass after regeneration:\n${fresh.output}`);
});

test('a mirror schema diverging from the locale owner fails closed with a named diagnostic', () => {
  const sandbox = makeSchemaSandbox([
    {
      file: 'catalog.schema.json',
      apply: (doc) => {
        doc.properties.routes.items.properties.locales.items.enum.push('pl');
      },
    },
  ]);
  const run = runGenerator(['--schemas', sandbox, '--out', path.join(os.tmpdir(), 'kudy-wire-must-not-write.ts')]);
  assert.notEqual(run.status, 0, 'the compatibility gate must fail closed');
  assert.match(run.output, /diverges from its canonical owner/, 'the diagnostic must name the divergence');
});

test('the committed projection keeps the v1-only shapes and the generated header', () => {
  const text = readCommitted();
  assert.match(text, /GENERATED FILE — do not edit by hand/, 'the generated header must be present');
  assert.match(text, /export const SCHEMA_LOCALES = \['be', 'en', 'uk'\] as const;/, 'the owner list must be derived, in owner order');
  assert.match(text, /schema_version: 1;/, 'the pointer keeps the const-1 major');
  assert.match(text, /sizes: \{ base: number; extended\?: number \};/, 'sizes keeps base required, extended optional');
  for (const shape of ['CatalogRouteEntry', 'CatalogPointer', 'CatalogView', 'RouteStop', 'RouteDoc']) {
    assert.match(text, new RegExp(`export interface ${shape}\\b`), `the ${shape} projection must be present`);
  }
});

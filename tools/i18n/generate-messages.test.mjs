// G21.25 — the generator's own suite. Three planned deliverables of issue #558:
// generator_reproducible (repeated generation is byte-identical and equals the
// committed files), generated_catalogue_fresh (--check passes on the committed
// tree and names every missing, edited or stale output, fail-closed on a
// translation contract violation) and message_rendering_safe (the escaping
// round-trips through real generated code; unsupported shapes are refused).
// Node stdlib only (tools-zone-closed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectOutputs, DOMAINS, escapeTemplate, parseTemplate, renderTemplateRecord, run } from './generate-messages.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
// The translation sets the plan renders (the source locale be projects from
// source.json): derived from the plan, so a new output locale joins this
// fixture the commit it joins the plan.
const TRANSLATED_LOCALES = [...new Set(DOMAINS.flatMap((domain) => domain.outputs.flatMap((output) => output.locales)))]
  .filter((locale) => locale !== 'be');

test('generator_reproducible: repeated generation is byte-identical', () => {
  const first = collectOutputs();
  const second = collectOutputs();
  assert.deepEqual(second, first);
  assert.ok(first.length >= 10, 'every planned output is rendered');
  for (const output of first) {
    assert.match(output.content, /^\/\/ GENERATED FILE — do not edit\./);
    assert.ok(!/\b20\d\d-\d\d-\d\d\b/.test(output.content), `${output.file}: no timestamp in the generated header`);
  }
});

test('generator_reproducible: the committed generated files equal the generator output', () => {
  for (const output of collectOutputs()) {
    const committed = readFileSync(join(root, output.file), 'utf8');
    assert.equal(committed, output.content, `${output.file}: committed content drifted from the generator`);
  }
});

test('generated_catalogue_fresh: --check passes on the committed tree', () => {
  const lines = [];
  const verdict = run(['--check'], { log: (line) => lines.push(line), error: (line) => lines.push(line) });
  assert.deepEqual(verdict, { status: 'fresh', files: collectOutputs().map((output) => output.file) });
  assert.ok(lines.some((line) => line.includes('files fresh')), lines.join('\n'));
});

test('generated_catalogue_fresh: a missing and an edited output are named, the real tree untouched', () => {
  // A minimal fake root carries only the data files the generator reads; the
  // outputs are absent, so the check must name all of them as missing without
  // touching the real tree.
  const fake = mkdtempSync(join(tmpdir(), 'kudy-g2125-'));
  try {
    mkdirSync(join(fake, 'contracts/ui-messages/translations'), { recursive: true });
    cpSync(join(root, 'contracts/ui-messages/source.json'), join(fake, 'contracts/ui-messages/source.json'));
    for (const locale of TRANSLATED_LOCALES) {
      cpSync(
        join(root, `contracts/ui-messages/translations/${locale}.json`),
        join(fake, `contracts/ui-messages/translations/${locale}.json`),
      );
    }
    const problems = [];
    const missing = run(['--check'], { root: fake, log: () => {}, error: (line) => problems.push(line) });
    assert.equal(missing.status, 'stale');
    const missingFiles = collectOutputs().map((output) => output.file);
    for (const file of missingFiles) {
      assert.ok(problems.some((line) => line.includes(file) && line.includes('is missing')), `${file}: ${problems.join('\n')}`);
    }

    // One output restored but edited by one byte: the same file is named as
    // differing, the others stay missing.
    const outputs = collectOutputs();
    const first = outputs[0];
    mkdirSync(join(fake, dirname(first.file)), { recursive: true });
    writeFileSync(join(fake, first.file), `${first.content}\n// hand edit\n`, 'utf8');
    const edited = run(['--check'], { root: fake, log: () => {}, error: (line) => problems.push(line) });
    assert.equal(edited.status, 'stale');
    assert.ok(problems.some((line) => line.includes(first.file) && line.includes('differs from the generator output')), problems.join('\n'));

    // A translation set violating its contract fails closed with the named
    // rule — the generator never renders from unvalidated data.
    const set = JSON.parse(readFileSync(join(fake, 'contracts/ui-messages/translations/uk.json'), 'utf8'));
    set.records[0].reviewedSourceHash = '0'.repeat(64);
    writeFileSync(join(fake, 'contracts/ui-messages/translations/uk.json'), JSON.stringify(set, null, 2), 'utf8');
    rmSync(join(fake, first.file));
    const errors = [];
    const failed = run(['--check'], { root: fake, log: () => {}, error: (line) => errors.push(line) });
    assert.equal(failed.status, 'error');
    assert.ok(errors.some((line) => line.includes('stale_translation_denied')), errors.join('\n'));
  } finally {
    rmSync(fake, { recursive: true, force: true });
  }
});

test('message_rendering_safe: escaped static text round-trips through real generated code', async () => {
  // Hostile static text (backtick, backslash, newline, tab, quotes) in a
  // translation value; the emitted arrow function must render the original
  // characters back — no eval involved, the generated source is imported
  // through the standard strip-types loader.
  const value = 'адказ: ${text}\nрадок \`з коскаю\` і "цытата" + \'апостраф\' + \\ таб\tканец';
  const record = {
    id: 'test.safe.answer',
    source: 'адказ: ${text}',
    context: 'Тэст бяспекі рэндэру',
    format: 'template',
    parameters: [{ name: 'text', type: 'string' }],
  };
  const fnSource = renderTemplateRecord(record, { value });
  assert.ok(fnSource.includes("\\`"), 'the backtick is escaped in the emitted source');
  assert.ok(fnSource.includes('\\n'), 'the newline is escaped in the emitted source');
  const module = `export const f = ${fnSource};\n`;
  const fake = mkdtempSync(join(tmpdir(), 'kudy-g2125-safe-'));
  try {
    const file = join(fake, 'safe-probe.ts');
    writeFileSync(file, module, 'utf8');
    const rendered = (await import(file)).f('X');
    assert.equal(rendered, 'адказ: X\nрадок `з коскаю` і "цытата" + \'апостраф\' + \\ таб\tканец');
  } finally {
    rmSync(fake, { recursive: true, force: true });
  }
});

test('message_rendering_safe: unsupported shapes are refused, patterns stay data-only', () => {
  const record = {
    id: 'test.safe.bad',
    source: 'тэкст',
    context: 'Тэст',
    format: 'template',
    parameters: [{ name: 'count', type: 'number' }],
    discreteForms: { damaged: 'пашкоджана' },
  };
  assert.throws(() => renderTemplateRecord(record, { value: 'тэкст' }), /named discrete forms need a signature config/);
  // A placeholder naming no declared parameter cannot render.
  const bogus = {
    id: 'test.safe.bogus',
    source: '${nothing}',
    context: 'Тэст',
    format: 'template',
    parameters: [{ name: 'count', type: 'number' }],
  };
  assert.throws(() => renderTemplateRecord(bogus, { value: '${nothing}' }), /names no declared parameter/);
  // The emitted source carries no eval/import/Function anywhere.
  for (const output of collectOutputs()) {
    assert.doesNotMatch(output.content, /\beval\s*\(|\bnew Function\b|\bimport\s*\(/, output.file);
  }
});

test('parseTemplate and escapeTemplate answer deterministically', () => {
  assert.deepEqual(
    parseTemplate('Час: ад ${minMinutes} да ${maxMinutes} хв'),
    [{ text: 'Час: ад ' }, { param: 'minMinutes' }, { text: ' да ' }, { param: 'maxMinutes' }, { text: ' хв' }],
  );
  assert.deepEqual(parseTemplate('проста тэкст'), [{ text: 'проста тэкст' }]);
  assert.equal(escapeTemplate('а`б\\в${г}\nд'), 'а\\`б\\\\в\\${г}\\nд');
});

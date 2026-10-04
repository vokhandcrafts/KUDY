// G21.25 (issue #558) — the UI-message catalogue generator. The runtime
// native/controller and web catalogues are reproducible projections of
// contracts/ui-messages/source.json (the be base text) plus the reviewed
// per-locale translation sets (contracts/ui-messages/translations/) — never
// parallel hand-maintained originals (spec 2026-10-03-single-source-translations).
//
// Supported message patterns (the recorded catalog format, no ICU): plain
// text; `${name}` templates over the record's typed parameters (number /
// string / list with its join); a parameter fallback (`?? "—"`, from the
// canonical record, not the translation); numeric and named discreteForms;
// `composed: true` — the segment before the last parameter renders only when
// that parameter is non-empty (the conditional audio segment of
// textAudioLine). Dictionary text is data: the generator emits escaped static
// text and parameter interpolations only — no eval, no executable template
// snippets, no runtime LLM or remote calls.
//
// Modes: writing (default) renders every planned output; `--check` renders
// and byte-compares — a removed, edited or stale generated output fails with
// a named path and exit code 1. Repeated generation is byte-identical: the
// output carries no timestamp and every ordering comes from the data files.
//
// tools/ zone: node:* builtins and contracts/ imports only
// (.dependency-cruiser.cjs tools-zone-closed); run with
// `node --experimental-strip-types` — the locale registry is imported from
// contracts/ui-locales.ts so the codes stay defined once.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadUiMessagesSource } from '../../contracts/ui-messages/ui-messages.mjs';
import { loadUiMessageTranslations } from '../../contracts/ui-messages/translations.mjs';
import { UI_LOCALES } from '../../contracts/ui-locales.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TRANSLATIONS_DIR = 'contracts/ui-messages/translations';

// The TS type of each canonical parameter type (the #542 selector signatures).
// A string parameter with a canonical fallback accepts null — the fallback is
// what renders instead of it.
const TS_PARAM_TYPE = { number: 'number', string: 'string', list: 'readonly string[]' };

function parameterTsType(parameter) {
  if (parameter.type === 'string' && parameter.fallback !== undefined) return 'string | null';
  return TS_PARAM_TYPE[parameter.type] ?? parameter.type;
}

// The output plan: one entry per generated file. `locales` is the rendered
// locale order; `annotation` types the export against the existing interface
// (chrome and guideHint import their shapes from the contracts zone — the
// controller data files stay un-annotated, their hand adapters annotate, so
// no hand↔generated cycle exists for the no-cycles arch rule); `signature`
// carries the one record whose function argument is a state object rather
// than the raw parameters (preview.detail — the controller-owned
// PreviewDetail vocabulary, restated structurally, not imported).
const DOMAINS = [
  {
    domain: 'native.chrome',
    note: 'the shared UI chrome words (G06.05 #280; G14.04.d #305; G06.10 #432, #403; UX 05 #351; G15.03 #70)',
    outputs: [
      {
        file: 'components/ui-strings.generated.ts',
        exportName: 'UI_STRINGS',
        locales: ['be', 'en', 'uk'],
        annotation: 'Record<CompleteUiLocaleCode, UiStrings>',
        imports: [
          'import { completeUiLocaleSelfNames, type CompleteUiLocaleCode } from "../contracts/ui-locales.ts";',
          'import type { UiStrings } from "../contracts/ui-message-types.ts";',
        ],
        // G21.09: a language is never named through a translation — the
        // self-name words stay defined once in the locale registry and the
        // catalogue keeps embedding the registry call, not the words.
        selfNames: 'native.chrome.languageSelfNames',
      },
    ],
  },
  {
    domain: 'native.guideHint',
    note: 'the nearby guide-hint card\'s words (G07.05 #284); uk keeps the documented be fallback (uk-release-scope §6.4) until its words are authored',
    outputs: [
      {
        file: 'components/guide-hint-strings.generated.ts',
        exportName: 'GUIDE_HINT_STRINGS',
        locales: ['be', 'en'],
        annotation: 'Record<"be" | "en", GuideHintStrings>',
        imports: ['import type { GuideHintStrings } from "../contracts/ui-message-types.ts";'],
      },
    ],
  },
  {
    domain: 'native.preview',
    note: 'the guide preview\'s words (G06.05 #280, AC4/AC5; G08.05 #292)',
    outputs: [
      {
        file: 'controllers/catalog/preview-strings.generated.ts',
        exportName: 'PREVIEW_STRINGS_DATA',
        locales: ['be', 'en', 'uk'],
        signature: {
          // The detail function receives the controller's PreviewDetail state
          // object (kind + the missing-files count), not the raw parameters;
          // the structural type accepts every PreviewDetail variant.
          'native.preview.detail': {
            args: [{ name: 'detail', type: '{ readonly kind: string; readonly count?: number }' }],
            kindPath: 'detail.kind',
            paramPaths: { count: 'detail.count' },
          },
        },
      },
    ],
  },
  {
    domain: 'native.run',
    note: 'the run-map surface\'s words (G06.05 #280; UX 05 #351; G07.x run stack)',
    outputs: [
      {
        file: 'controllers/run/runMap-strings.generated.ts',
        exportName: 'RUN_MAP_STRINGS_DATA',
        locales: ['be', 'en', 'uk'],
      },
    ],
  },
  {
    domain: 'native.place',
    note: 'the place-detail words (G06.05 #280, AC4/AC5)',
    outputs: [
      {
        file: 'controllers/place/placeDetail-strings.generated.ts',
        exportName: 'PLACE_DETAIL_STRINGS_DATA',
        locales: ['be', 'en', 'uk'],
      },
    ],
  },
  {
    domain: 'native.nearby',
    note: 'the nearby surface\'s words (the runMapStrings idiom; UX 09 #434)',
    outputs: [
      {
        file: 'controllers/nearby/nearbySurface-strings.generated.ts',
        exportName: 'NEARBY_STRINGS_DATA',
        locales: ['be', 'en', 'uk'],
      },
    ],
  },
  {
    domain: 'native.offer',
    note: 'the commerce offer card\'s words (11 §8; G08.05 #292)',
    outputs: [
      {
        file: 'controllers/commerce/commerce-strings.generated.ts',
        exportName: 'OFFER_STRINGS_DATA',
        locales: ['be', 'en', 'uk'],
      },
    ],
  },
  {
    domain: 'web.ui',
    note: 'the web channel\'s UI words (09 §8: «ніводнага зашытага радка нідзе»; G14.04.d #305)',
    outputs: [
      { file: 'web/lib/i18n/be.ts', exportName: 'be', locales: ['be'] },
      { file: 'web/lib/i18n/en.ts', exportName: 'en', locales: ['en'] },
      { file: 'web/lib/i18n/uk.ts', exportName: 'uk', locales: ['uk'] },
    ],
  },
];

// --- template compilation ----------------------------------------------------

// Escapes static text for a template-literal body: the backslash first, then
// the backtick and the ${ sequence, then the control characters as explicit
// escapes. Quotes need no escape inside backticks; the escape is deterministic
// and idempotent-free by construction (each rule runs once, in this order).
export function escapeTemplate(text) {
  return text
    .replaceAll('\\', '\\\\')
    .replaceAll('`', '\\`')
    .replaceAll('${', '\\${')
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
    .replaceAll('\t', '\\t');
}

// Splits a message pattern into literal and parameter segments (the ${name}
// contract of the canonical records).
export function parseTemplate(value) {
  const segments = [];
  let last = 0;
  for (const match of value.matchAll(/\$\{([^{}]*)\}/g)) {
    if (match.index > last) segments.push({ text: value.slice(last, match.index) });
    segments.push({ param: match[1] });
    last = match.index + match[0].length;
  }
  if (last < value.length) segments.push({ text: value.slice(last) });
  return segments;
}

// The interpolation expression of one parameter: lists join with the
// record's separator, strings fall back through the record's canonical
// fallback, everything else interpolates directly.
function parameterExpression(record, name, paramPaths = {}) {
  if (paramPaths[name] !== undefined) return paramPaths[name];
  const parameter = record.parameters.find((candidate) => candidate?.name === name);
  if (!parameter) {
    throw new Error(`generate-messages: ${record.id}: placeholder ${name} names no declared parameter`);
  }
  if (parameter.type === 'list') {
    if (typeof parameter.join !== 'string' || parameter.join === '') {
      throw new Error(`generate-messages: ${record.id}: list parameter ${name} carries no join`);
    }
    return `${name}.join(${JSON.stringify(parameter.join)})`;
  }
  if (parameter.fallback !== undefined) {
    return `${name} ?? ${JSON.stringify(parameter.fallback)}`;
  }
  return name;
}

// The template-literal body for one message pattern.
function renderBody(record, value, paramPaths = {}) {
  const body = parseTemplate(value)
    .map((segment) =>
      segment.text !== undefined
        ? escapeTemplate(segment.text)
        : `\${${parameterExpression(record, segment.param, paramPaths)}}`,
    )
    .join('');
  return `\`${body}\``;
}

// The arrow-function source for a template record in one locale: discrete
// forms chain as ternaries over their selector (numeric keys numerically
// sorted; named keys through the record's signature config), composed
// messages guard the tail on the last parameter, everything else renders
// the pattern directly.
export function renderTemplateRecord(record, localeValue, signature) {
  if (!signature && record.discreteForms) {
    const numeric = Object.keys(record.discreteForms).every((key) => !Number.isNaN(Number(key)));
    if (!numeric) {
      throw new Error(`generate-messages: ${record.id}: named discrete forms need a signature config`);
    }
  }
  const config = signature ?? {};
  const args = config.args ?? record.parameters.map((parameter) => ({
    name: parameter.name,
    type: parameterTsType(parameter),
  }));
  const head = `(${args.map((argument) => `${argument.name}: ${argument.type}`).join(', ')}) => `;

  if (record.discreteForms) {
    const keys = Object.keys(record.discreteForms);
    const localeForms = localeValue.forms ?? {};
    const numeric = keys.every((key) => !Number.isNaN(Number(key)));
    const base = renderBody(record, localeValue.value, config.paramPaths ?? {});
    if (numeric) {
      const selector = record.parameters.find((parameter) => parameter.type === 'number');
      if (!selector) {
        throw new Error(`generate-messages: ${record.id}: numeric discrete forms need a number parameter`);
      }
      const chain = keys
        .sort((left, right) => Number(left) - Number(right))
        .map((key) => `${selector.name} === ${Number(key)} ? ${renderBody(record, localeForms[key])}`)
        .join(' : ');
      return `${head}${chain} : ${base}`;
    }
    if (!config.kindPath) {
      throw new Error(`generate-messages: ${record.id}: named discrete forms need a kindPath`);
    }
    const chain = keys
      .map((key) => `${config.kindPath} === ${JSON.stringify(key)} ? ${renderBody(record, localeForms[key], config.paramPaths ?? {})}`)
      .join(' : ');
    return `${head}${chain} : ${base}`;
  }

  if (record.composed) {
    const segments = parseTemplate(localeValue.value);
    const lastParam = segments.length - 1;
    if (segments[lastParam]?.param === undefined || segments[lastParam - 1]?.text === undefined) {
      throw new Error(`generate-messages: ${record.id}: composed message needs a literal segment before its last parameter`);
    }
    const parameter = record.parameters.find((candidate) => candidate.name === segments[lastParam].param);
    const head2 = segments.slice(0, lastParam - 1);
    const tail = segments.slice(lastParam - 1);
    const guard = parameter.type === 'list'
      ? `${parameter.name}.length > 0`
      : `${parameter.name} !== ""`;
    const render = (parts) => parts.map((segment) => segment.text !== undefined
      ? escapeTemplate(segment.text)
      : `\${${parameterExpression(record, segment.param)}}`).join('');
    return `${head}\`${render(head2)}\${${guard} ? \`${render(tail)}\` : ""}\``;
  }

  return `${head}${renderBody(record, localeValue.value)}`;
}

// --- output assembly ---------------------------------------------------------

const GENERATED_HEADER = [
  '// GENERATED FILE — do not edit. Regenerate with:',
  '//   node --experimental-strip-types tools/i18n/generate-messages.mjs',
  '//',
  '// Source of truth: contracts/ui-messages/source.json (the be base text) and',
  '// contracts/ui-messages/translations/<locale>.json (the reviewed translations).',
  '// G21.25 (issue #558): the catalogues are generated projections — edit the',
  "// source/translation data, never this file; the generator's --check mode",
  '// fails on any hand edit.',
];

// Builds the nested catalogue tree for one locale in the records' canonical
// order (the order the catalogs were inventoried in — G21.24), resolving each
// record's locale value from the base text (be) or the translation set.
function buildLocaleTree(records, locale, sourceLocale, translationsById, output) {
  const tree = {};
  for (const record of records) {
    if (output.selfNames && record.id.startsWith(`${output.selfNames}.`)) {
      tree[output.selfNames.split('.').pop()] = { selfNames: true };
      continue;
    }
    let entry;
    if (locale === sourceLocale) {
      entry = { value: record.source, forms: record.discreteForms };
    } else {
      const translation = translationsById.get(record.id);
      if (!translation) {
        throw new Error(`generate-messages: ${record.id}: no ${locale} translation for a planned output locale`);
      }
      entry = { value: translation.value, forms: translation.forms };
    }
    const parts = record.id.split('.').slice(2);
    let node = tree;
    for (const part of parts.slice(0, -1)) node = node[part] ??= {};
    const key = parts[parts.length - 1];
    if (record.format === 'plain') {
      node[key] = entry.value;
    } else {
      node[key] = { fn: renderTemplateRecord(record, entry, output.signature?.[record.id]) };
    }
  }
  return tree;
}

function emitTree(tree, indent) {
  const lines = [];
  for (const [key, value] of Object.entries(tree)) {
    const quoted = JSON.stringify(key);
    if (value && value.selfNames) {
      lines.push(`${indent}${quoted}: completeUiLocaleSelfNames(),`);
    } else if (typeof value === 'string') {
      lines.push(`${indent}${quoted}: ${JSON.stringify(value)},`);
    } else if (value && value.fn) {
      lines.push(`${indent}${quoted}: ${value.fn},`);
    } else {
      lines.push(`${indent}${quoted}: {`);
      lines.push(...emitTree(value, `${indent}  `));
      lines.push(`${indent}},`);
    }
  }
  return lines;
}

// Loads the canonical source plus every translation set the plan needs, and
// fails closed on any contract violation before a byte is rendered.
export function loadInputs({ root = ROOT } = {}) {
  const sourceDoc = loadUiMessagesSource(join(root, 'contracts/ui-messages/source.json'));
  const sourceLocale = sourceDoc.source_locale;
  const allowedLocales = UI_LOCALES.map((entry) => entry.code);
  const needed = [...new Set(DOMAINS.flatMap((domain) => domain.outputs.flatMap((output) => output.locales)))]
    .filter((locale) => locale !== sourceLocale);
  const translations = {};
  for (const locale of needed) {
    translations[locale] = loadUiMessageTranslations(
      join(root, TRANSLATIONS_DIR, `${locale}.json`),
      sourceDoc,
      allowedLocales,
    );
  }
  return { sourceDoc, sourceLocale, translations, allowedLocales };
}

// Renders every planned output file. Pure over the data files: calling it
// twice yields byte-identical content.
export function collectOutputs({ root = ROOT } = {}) {
  const { sourceDoc, sourceLocale, translations } = loadInputs({ root });
  const byId = Object.fromEntries(
    Object.entries(translations).map(([locale, set]) => [
      locale,
      new Map(set.records.map((record) => [record.id, record])),
    ]),
  );
  const planned = new Set(DOMAINS.map((domain) => `${domain.domain}.`));
  for (const record of sourceDoc.records) {
    if (![...planned].some((prefix) => record.id.startsWith(prefix))) {
      throw new Error(`generate-messages: ${record.id}: no output plan covers this record`);
    }
  }
  const outputs = [];
  for (const domain of DOMAINS) {
    const records = sourceDoc.records.filter((record) => record.id.startsWith(`${domain.domain}.`));
    if (records.length === 0) {
      throw new Error(`generate-messages: ${domain.domain}: the plan names a domain the source has no records for`);
    }
    for (const output of domain.outputs) {
      const blocks = output.locales.map((locale) => {
        const tree = buildLocaleTree(records, locale, sourceLocale, byId[locale] ?? new Map(), output);
        return { locale, lines: emitTree(tree, output.locales.length > 1 ? '    ' : '  ') };
      });
      const lines = [
        ...GENERATED_HEADER,
        `// ${domain.note}`,
        '',
        ...(output.imports ?? []),
        '',
      ];
      if (output.locales.length > 1) {
        const annotation = output.annotation ? `: ${output.annotation}` : '';
        lines.push(`export const ${output.exportName}${annotation} = {`);
        for (const block of blocks) {
          lines.push(`  ${JSON.stringify(block.locale)}: {`);
          lines.push(...block.lines);
          lines.push('  },');
        }
        lines.push('};');
      } else {
        const annotation = output.annotation ? `: ${output.annotation}` : '';
        lines.push(`export const ${output.exportName}${annotation} = {`);
        lines.push(...blocks[0].lines);
        lines.push('};');
      }
      outputs.push({ file: output.file, content: `${lines.join('\n')}\n` });
    }
  }
  return outputs;
}

// The command: writing (default) renders every output; --check byte-compares
// and names every missing, edited or stale generated file. Contract failures
// and plan violations answer with a named message and exit code 1.
export function run(argv = process.argv.slice(2), { root = ROOT, log = console.log, error = console.error } = {}) {
  const check = argv.includes('--check');
  try {
    const outputs = collectOutputs({ root });
    if (!check) {
      for (const output of outputs) {
        writeFileSync(join(root, output.file), output.content, 'utf8');
        log(`generated messages: wrote ${output.file}`);
      }
      log(`generated messages: ${outputs.length} files written`);
      return { status: 'written', files: outputs.map((output) => output.file) };
    }
    const problems = [];
    for (const output of outputs) {
      const path = join(root, output.file);
      if (!existsSync(path)) {
        problems.push(`stale generated output: ${output.file} is missing — run node --experimental-strip-types tools/i18n/generate-messages.mjs`);
        continue;
      }
      if (readFileSync(path, 'utf8') !== output.content) {
        problems.push(`stale generated output: ${output.file} differs from the generator output — run node --experimental-strip-types tools/i18n/generate-messages.mjs`);
      }
    }
    if (problems.length > 0) {
      for (const problem of problems) error(`generated messages: ${problem}`);
      return { status: 'stale', problems };
    }
    log(`generated messages: ${outputs.length} files fresh`);
    return { status: 'fresh', files: outputs.map((output) => output.file) };
  } catch (err) {
    if (err instanceof Error && (err.name === 'TranslationsContractError' || err.name === 'UiMessagesContractError')) {
      error(`generated messages: ${err.message}`);
      return { status: 'error', problems: [err.message] };
    }
    throw err;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}

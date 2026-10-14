import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

import type { StopRow } from '../lib/content/site.ts';
import type { UiStrings } from '../lib/i18n/index.ts';
import { getUiStrings, uiLocales } from '../lib/i18n/index.ts';

const require = createRequire(import.meta.url);
const componentFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'locked-stop-row.tsx');
const componentCode = ts.transpileModule(fs.readFileSync(componentFile, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const compiled = { exports: {} as { LockedStopRow?: React.ComponentType<{ stop: StopRow; strings: UiStrings }> } };
new Function('require', 'module', 'exports', componentCode)(require, compiled, compiled.exports);

test('locked stop icon uses every released locale label without changing the public preview', () => {
  const LockedStopRow = compiled.exports.LockedStopRow;
  assert.ok(LockedStopRow);
  const stop = {
    stop_id: 'test-stop',
    place_id: 'test-place',
    href: '/guides/test/stops/test-stop',
    name: 'Test stop',
    announce: 'Public announcement',
    locked: true,
  };
  for (const locale of uiLocales) {
    const html = renderToStaticMarkup(React.createElement(LockedStopRow, { stop, strings: getUiStrings(locale) }));
    assert.match(html, /<svg\b[^>]*role="img"/, `${locale}: lock must be an inline SVG`);
    assert.ok(html.includes(`aria-label="${getUiStrings(locale).lockedLabel}"`), `${locale}: localized lock name`);
    assert.ok(html.includes(['href', '="', stop.href, '"'].join('')), `${locale}: stop link`);
    assert.ok(html.includes(`<strong>${stop.name}</strong>`), `${locale}: stop name`);
    assert.ok(html.includes(`<p>${stop.announce}</p>`), `${locale}: public announcement`);
    assert.equal(html.includes('🔒'), false, `${locale}: no platform emoji`);
  }
});

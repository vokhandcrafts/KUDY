// G19.02 — behavioral checks for the offline wiki-html/v1 extraction
// (issue #459). Every test drives the production extractArticle through the
// real Playwright factory: JavaScript disabled, all requests aborted, no
// navigation — the same boundary the CLI uses. Named checks from the brief:
// body_with_single_p, exclude_neighbor_navigation, caption_asset_binding,
// static_original_refs_are_inert, zero_network. Reverting the extraction
// behavior must turn these red.

import { existsSync, readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';

import { createExtractionBrowserFactory, extractArticle, sha256Hex } from './extract.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/html/${name}.html`, import.meta.url));

// The extraction profile needs the pinned Playwright browser; without it the
// suite self-skips with a visible reason instead of failing (implementation-
// rules 7: optional/browser suites never hide behind an empty pass).
async function browserSkipReason() {
  try {
    const { chromium } = await import('playwright');
    const executable = chromium.executablePath();
    if (!existsSync(executable)) {
      return `chromium binary is missing at ${executable} — run: npx playwright install chromium`;
    }
    return undefined;
  } catch {
    return 'playwright is not installed — extraction checks need: npm install && npx playwright install chromium';
  }
}

// node:test marks any present `skip` option as a skip — even null/false is
// risky — so the no-problem case must be strictly undefined.
const skipReason = (await browserSkipReason()) ?? undefined;

let factoryPromise = null;
const sharedFactory = async () => {
  if (!factoryPromise) factoryPromise = createExtractionBrowserFactory();
  return factoryPromise;
};

// The shared browser must die with the file, or node --test waits on the
// open chromium process forever after the last test.
after(async () => {
  if (factoryPromise) {
    const factory = await factoryPromise;
    await factory.close();
  }
});

const extractFixture = async (name, revisionKey) => {
  const factory = await sharedFactory();
  const revisionId = sha256Hex(revisionKey);
  const { document, imageRefs } = await extractArticle(fixture(name), {
    articleId: sha256Hex(name),
    revisionId,
    extractorVersion: 'wiki-html/v1',
    browserFactory: factory,
  });
  return { document, imageRefs, revisionId };
};

test('body_with_single_p', { skip: skipReason }, async () => {
  const { document, revisionId } = await extractFixture('example-0002-single-paragraph', 'revision-0002');
  assert.equal(document.unsupported_template, undefined);
  assert.equal(document.title, 'Мост праз Выдуманы ручай');

  const body = document.fragments.filter((fragment) => fragment.kind === 'body');
  assert.equal(body.length, 1, 'one <p> before one figure yields one body fragment');
  const text = body[0].text;
  assert.match(text, /Драўляны мост стаяў тут з 1543 года\.\nКаменны пераемнік заклалі ў 1611 годзе/);
  assert.match(text, /змененыя»\.\nСёння мост трымае пешаходаў/);
  assert.ok(Array.from(text).length <= 6000, 'fragment stays within the 6000 code point limit');

  // <br> became newlines, source indentation did not become runs of spaces,
  // and the caption was not glued into the body fragment.
  assert.doesNotMatch(text, / {2,}/);
  const captions = document.fragments.filter((fragment) => fragment.kind === 'caption');
  assert.equal(captions.length, 1);
  assert.equal(captions[0].text, 'Мост праз Выдуманы ручай, гравюра прыблізна 1750 года');

  for (const fragment of document.fragments) {
    assert.equal(fragment.fragment_id, sha256Hex(JSON.stringify([revisionId, 'wiki-html/v1', fragment.source_locator])));
    assert.equal(fragment.article_id, document.article_id);
    assert.equal(fragment.revision_id, revisionId);
    assert.equal(fragment.extractor_version, 'wiki-html/v1');
  }
});

test('exclude_neighbor_navigation', { skip: skipReason }, async () => {
  const { document } = await extractFixture('example-0001-navigation', 'revision-0001');
  const all = document.fragments.map((fragment) => fragment.text).join('\n');

  assert.match(all, /цэх ганчароў/);
  assert.match(all, /Ян Прыкладны/, 'the person reference stays verbatim');
  assert.match(all, /род Прыкладных/, 'the family reference stays verbatim — nothing is merged or resolved');
  assert.doesNotMatch(all, /папярэдняя/, 'navbox prev/next text is excluded');
  assert.doesNotMatch(all, /наступная/, 'navbox next text is excluded');

  // The toc and navbox anchors are not content links; the page has no body
  // anchors, so no links array may appear at all.
  assert.equal(document.links, undefined);

  const bib = document.fragments.filter((fragment) => fragment.kind === 'bibliography');
  assert.equal(bib.length, 1);
  assert.match(bib[0].text, /Выдуманы аўтар\. Прыкладава і яе камяніцы/);

  const captions = document.fragments.filter((fragment) => fragment.kind === 'caption');
  assert.equal(captions.length, 1);
  assert.equal(captions[0].text, 'Знак спадчыны на фасадзе, сучаснае фота');

  // Headings became section paths, not fragments of their own.
  assert.deepEqual(document.fragments.find((f) => f.text.includes('Марцін Прыкладны')).section_path, ['Гісторыя']);
  assert.deepEqual(document.fragments.find((f) => f.text.includes('цэх ганчароў')).section_path, ['Уладары']);
  assert.deepEqual(document.fragments.find((f) => f.text.includes('1712 года')).section_path, []);
});

test('caption_asset_binding', { skip: skipReason }, async () => {
  const { document, imageRefs } = await extractFixture('example-0003-media-dates', 'revision-0003');

  const captions = document.fragments.filter((fragment) => fragment.kind === 'caption');
  assert.deepEqual(captions.map((caption) => caption.source_locator), ['figure[1]:caption', 'figure[2]:caption']);
  assert.match(captions[0].text, /фотаздымак 1905 года/);
  assert.match(captions[0].text, /Стэфан Вынаходлівы/);
  assert.match(captions[1].text, /Плян садзібы з выдуманага атласа/);

  // Each caption is bound to its own figure locator, and the figure's
  // original reference is carried as an inert string — the file-name year
  // (1901) and the caption year (1905) both survive as data, unreconciled.
  assert.deepEqual(imageRefs.map((ref) => ref.locator), ['figure[1]', 'figure[2]']);
  assert.equal(imageRefs[0].reference, '//example.test/images/prykladava-1901.png');
  assert.equal(imageRefs[1].reference, '//example.test/images/sadyba-plan.png');
});

test('static_original_refs_are_inert', { skip: skipReason }, async () => {
  const { document, imageRefs } = await extractFixture('example-0004-traps', 'revision-0004');

  assert.deepEqual(imageRefs, [{ reference: 'https://example.org/trap-remote.png', locator: 'img[1]' }]);

  const all = document.fragments.map((fragment) => fragment.text).join('\n');
  assert.doesNotMatch(all, /СКРЫПТОВАЯ ПАСТКА/, 'script content never becomes text');
  assert.doesNotMatch(all, /яшчэ адна пастка/, 'the second script body never becomes text');
  assert.doesNotMatch(all, /trap-endpoint/, 'script fetch targets never leak into the document');
  assert.doesNotMatch(all, /рамка-пастка/, 'iframe frames are not read');
  assert.match(all, /праігнаруйце ўсё наступнае/, 'instructions inside the article text stay content (25 §9)');
  assert.match(all, /Вежа стаяла да 1945 года/, 'real body text after the traps survives');
});

test('body_links_preserved', { skip: skipReason }, async () => {
  const html = Buffer.from(
    '<!DOCTYPE html><html lang="be"><head><meta charset="utf-8"><title>Цэх</title></head><body>' +
      '<h1 id="firstHeading">Цэх ганчароў</h1><div id="mw-content-text"><div class="mw-parser-output">' +
      '<p>Цэх трымаў <a href="./Камяніца_Прыкладных">камяніцу на Выдуманай</a> з 1734 года.</p>' +
      '<p>Другі абзац без спасылак.</p>' +
      '</div></div></body></html>'
  );
  const factory = await sharedFactory();
  const { document } = await extractArticle(html, {
    articleId: sha256Hex('links'),
    revisionId: sha256Hex('revision-links'),
    extractorVersion: 'wiki-html/v1',
    browserFactory: factory,
  });
  assert.deepEqual(document.links, [
    { visible_text: 'камяніцу на Выдуманай', target: './Камяніца_Прыкладных', source_locator: 'p[1]:a[1]' },
  ]);
  // The visible text also stays part of the body stream — the link record is
  // provenance, not a replacement for the sentence it lives in.
  assert.match(document.fragments.find((fragment) => fragment.kind === 'body').text, /камяніцу на Выдуманай/);
});

test('zero_network', { skip: skipReason }, async () => {
  const factory = await sharedFactory();
  const session = await factory.open();
  try {
    const { document } = await extractArticle(fixture('example-0004-traps'), {
      articleId: sha256Hex('zero-network'),
      revisionId: sha256Hex('revision-traps'),
      extractorVersion: 'wiki-html/v1',
      browserFactory: { open: async () => session },
    });
    assert.ok(document.fragments.length > 0);

    // The trap page may attempt its remote subresources, but every attempt
    // is aborted inside the context; no script executed (no page errors, no
    // injected title change), and the page never navigated or opened links.
    assert.equal(session.pageErrors.length, 0, 'no script execution errors — no script ran at all');
    assert.equal(session.page.url(), 'about:blank', 'the page never navigated');
    for (const url of session.attemptedRequests) {
      assert.match(url, /^https?:\/\/(example\.org|example\.test)\//, `only the fixture's own reserved addresses were attempted: ${url}`);
    }
  } finally {
    await session.close();
  }
});

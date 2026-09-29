// Bare-URL suites (G17.09, issue #366): every test reaches the production
// extractPage — the same function the seed handler and the crawler call —
// plus one file:// fixture campaign run through the real CLI
// (testkit.collectAndClean). The proof of the suite is its revert: removing
// the bare-URL pass turns every test here red (implementation-rules 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { extractPage } from './extract.mjs';
import { openStore } from './store.mjs';
import { NEWS_BODY, articleHtml, collectAndClean, makeTempDir } from './testkit.mjs';

const BARE = 'https://gdansk.example/museum';

function paragraph(text) {
  return `<p>${text}</p>`;
}

test('AC1: a bare URL in paragraph text enters the links table and the crawler frontier rows', () => {
  const page = extractPage(articleHtml({ body: [paragraph(`Гл. ${BARE} у музеі верфі.`)] }), 'https://news.example/a');
  assert.equal(
    page.text,
    `Гл. [${BARE}](${BARE}) у музеі верфі.\n`,
    'the address stays visible as a markdown link at its position'
  );
  assert.deepEqual(page.links, [
    { anchor: BARE, url: BARE, context: `Гл. [${BARE}](${BARE}) у музеі верфі.` },
  ], 'anchor is the address itself, context is the paragraph');
});

test('a bare URL next to an anchored one keeps document order and both rows', () => {
  const page = extractPage(
    articleHtml({
      body: [
        paragraph(`Гл. <a href="https://a.example/x">крыніца</a> і ${BARE} побач.`),
      ],
    }),
    'https://news.example/a'
  );
  assert.equal(
    page.text,
    `Гл. [крыніца](https://a.example/x) і [${BARE}](${BARE}) побач.\n`
  );
  assert.deepEqual(
    page.links.map((link) => [link.anchor, link.url]),
    [
      ['крыніца', 'https://a.example/x'],
      [BARE, BARE],
    ]
  );
});

test('trailing sentence punctuation stays outside the address, visible text undamaged', () => {
  const page = extractPage(articleHtml({ body: [paragraph(`Гл. ${BARE}.`) ] }), 'https://news.example/a');
  assert.equal(page.text, `Гл. [${BARE}](${BARE}).\n`);
  assert.deepEqual(page.links.map((link) => link.url), [BARE]);
});

test('an unbalanced closing parenthesis stays outside the address, a balanced one stays inside', () => {
  const wrapped = extractPage(
    articleHtml({ body: [paragraph(`(гл. https://en.wikipedia.org/wiki/Верф)`) ] }),
    'https://news.example/a'
  );
  assert.equal(
    wrapped.text,
    '(гл. [https://en.wikipedia.org/wiki/Верф](https://en.wikipedia.org/wiki/Верф))\n'
  );
  const balanced = extractPage(
    articleHtml({ body: [paragraph('Гл. https://en.wikipedia.org/wiki/Gdańsk_(city).')] }),
    'https://news.example/a'
  );
  assert.deepEqual(balanced.links.map((link) => link.url), ['https://en.wikipedia.org/wiki/Gdańsk_(city)']);
  assert.equal(
    balanced.text,
    'Гл. [https://en.wikipedia.org/wiki/Gdańsk_(city)](https://en.wikipedia.org/wiki/Gdańsk_(city)).\n'
  );
});

test('AC3: scheme-less words never become links and never change the text', () => {
  const source = paragraph('Сайт www.gdansk.example і старонка example.org/museum, слова «http» — не адрас.');
  const page = extractPage(articleHtml({ body: [source] }), 'https://news.example/a');
  assert.deepEqual(page.links, [], 'no scheme prefix — no link rows');
  assert.equal(page.text, `${source.slice(3, -4)}\n`, 'the text is byte-for-byte the collapsed paragraph');
});

test('«https://» with nothing address-shaped after it stays plain text', () => {
  const page = extractPage(articleHtml({ body: [paragraph('Прэфікс схемы https:// без адраса, і https://. таксама.')] }), 'https://news.example/a');
  assert.deepEqual(page.links, []);
  assert.equal(page.text, 'Прэфікс схемы https:// без адраса, і https://. таксама.\n');
});

test('AC2: an anchored link is not re-wrapped — no nested markdown, no duplicate row', () => {
  const page = extractPage(
    articleHtml({
      body: [paragraph('<a href="https://a.example/x">пра https://b.example/y</a> і яшчэ раз пра https://b.example/y.')],
    }),
    'https://news.example/a'
  );
  assert.equal(
    page.text,
    '[пра https://b.example/y](https://a.example/x) і яшчэ раз пра [https://b.example/y](https://b.example/y).\n'
  );
  assert.deepEqual(
    page.links.map((link) => [link.anchor, link.url]),
    [
      ['пра https://b.example/y', 'https://a.example/x'],
      ['https://b.example/y', 'https://b.example/y'],
    ],
    'the address inside the anchored label is covered by that link, the one in open text is its own row'
  );
});

test('AC4: the same HTML always produces the same bytes and the same link rows', () => {
  const html = articleHtml({
    body: [
      paragraph(`Гл. ${BARE} і <a href="/rel">анкер</a>.`),
      paragraph('(а тут https://en.wikipedia.org/wiki/Gdańsk_(city).)'),
    ],
  });
  const first = extractPage(html, 'https://news.example/a');
  const second = extractPage(html, 'https://news.example/a');
  assert.equal(first.text, second.text);
  assert.deepEqual(first.links, second.links);
});

test('AC5: the file:// fixture campaign run persists the bare URL row and the markdown link in text.md and cleaned v1', () => {
  const dir = makeTempDir();
  const body = [
    ...NEWS_BODY.slice(0, 2),
    paragraph(`Дэталі: ${BARE} — музей верфі.`),
    paragraph('Адрас без схемы: www.gdansk.example — застаецца тэкстам.'),
    ...NEWS_BODY.slice(2),
  ];
  const { dbPath, snapshot } = collectAndClean(dir, { body });

  const db = openStore(dbPath);
  const bare = db.prepare('SELECT anchor_text, url, context FROM links WHERE url = ?').get(BARE);
  assert.ok(bare, 'the bare URL is a links row of the record');
  assert.equal(bare.anchor_text, BARE);
  assert.match(bare.context, /Дэталі: /);
  const plain = db.prepare('SELECT COUNT(*) AS n FROM links WHERE url LIKE ?').all('%www.gdansk.example%');
  assert.equal(plain[0].n, 0, 'the scheme-less address created no link row');

  const raw = fs.readFileSync(path.join(snapshot, 'text.md'), 'utf8');
  assert.ok(raw.includes(`[${BARE}](${BARE})`), 'text.md keeps the address as a markdown link');
  assert.ok(raw.includes('www.gdansk.example') && !raw.includes('[www.gdansk.example'), 'the scheme-less word stays plain text');
  const cleaned = fs.readFileSync(path.join(snapshot, 'cleaned', 'v1.md'), 'utf8');
  assert.ok(cleaned.includes(`[${BARE}](${BARE})`), 'the cleaned document carries the same markdown link');
});

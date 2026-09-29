// Bare-URL suites (G17.09, issue #366) and loose/lazy image suites (G17.10,
// issue #367): every test reaches the production extractPage — the same
// function the seed handler and the crawler call — plus one file:// fixture
// campaign run through the real CLI (testkit.collectAndClean). The proof of
// the suite is its revert: removing the bare-URL pass, the gap scan or the
// lazy-source chain turns the tests here red (implementation-rules 1).
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

test('an unbalanced opening parenthesis inside the address leaves the paragraph plain', () => {
  const page = extractPage(
    articleHtml({ body: [paragraph('Гл. https://y.com/a_(b — тэкст.')] }),
    'https://news.example/a'
  );
  assert.deepEqual(page.links, [], 'the broken address creates no link row');
  assert.equal(page.text, 'Гл. https://y.com/a_(b — тэкст.\n', 'the text stays byte-for-byte plain');
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

// G17.10 (issue #367): images standing outside paragraphs and figures and
// lazy-loaded sources follow the same collection rules as paragraph images —
// threshold, naming and positions are media.mjs business and stay untouched.

test('G17.10 AC1: an image outside paragraphs and figures lands at its document position', () => {
  const page = extractPage(
    [
      '<title>Yard</title>',
      '<p>Першы.</p>',
      '<div class="article-body"><img src="hero-640x400.png" alt="Hero" title="Двор"></div>',
      '<p>Другі.</p>',
      '<img src="tail-500x300.png" alt="Tail">',
      '<p>Трэці.</p>',
    ].join('\n'),
    'https://news.example/a'
  );
  assert.deepEqual(
    page.images.map((image) => [image.url, image.alt, image.caption, image.position]),
    [
      ['https://news.example/hero-640x400.png', 'Hero', 'Двор', 1],
      ['https://news.example/tail-500x300.png', 'Tail', null, 2],
    ],
    'loose images follow the figure semantics: they render exactly where they stood'
  );
  assert.equal(page.text, 'Першы.\n\nДругі.\n\nТрэці.\n', 'loose images never change the text');
});

test('G17.10 AC1: an image before the first paragraph renders before it, after the last — after it', () => {
  const leading = extractPage(
    ['<title>Yard</title>', '<header><img src="hero-640x400.png" alt="Hero"></header>', '<p>Першы.</p>'].join('\n'),
    'https://news.example/a'
  );
  assert.deepEqual(leading.images.map((image) => image.position), [0]);
  const trailing = extractPage(
    ['<title>Yard</title>', '<p>Першы.</p>', '<footer><img src="tail-500x300.png" alt="Tail"></footer>'].join('\n'),
    'https://news.example/a'
  );
  assert.deepEqual(trailing.images.map((image) => image.position), [1]);
});

test('G17.10 AC2: data-src beats the decorative src — the real image, no placeholder duplicate', () => {
  const page = extractPage(
    [
      '<title>Yard</title>',
      '<p>Тэкст.</p>',
      '<img src="placeholder-40x20.jpg" data-src="real-800x600.jpg" alt="Lazy">',
    ].join('\n'),
    'https://news.example/a'
  );
  assert.deepEqual(
    page.images.map((image) => image.url),
    ['https://news.example/real-800x600.jpg'],
    'one occurrence — the real source; the placeholder creates no photo'
  );
});

test('G17.10 AC2: a srcset-only image resolves to its largest candidate', () => {
  const page = (srcset) =>
    extractPage(['<title>Yard</title>', '<p>Тэкст.</p>', `<img srcset="${srcset}" alt="R">`].join('\n'), 'https://news.example/a');
  assert.deepEqual(
    page('small-320w.jpg 320w, large-800w.jpg 800w').images.map((image) => image.url),
    ['https://news.example/large-800w.jpg'],
    'the width descriptor decides'
  );
  assert.deepEqual(
    page('cover-1x.jpg 1x, cover-2x.jpg 2x').images.map((image) => image.url),
    ['https://news.example/cover-2x.jpg'],
    'the density descriptor decides'
  );
  assert.deepEqual(
    page('first.jpg, second.jpg').images.map((image) => image.url),
    ['https://news.example/first.jpg'],
    'a candidate without a descriptor counts as 1x, ties keep the earlier one'
  );
  assert.deepEqual(page('  ,,  ').images, [], 'a srcset with no candidates falls through — no image');
});

test('G17.10 AC2: data-src wins over srcset when both carry the real source', () => {
  const page = extractPage(
    ['<title>Yard</title>', '<p>Тэкст.</p>', '<img data-src="lazy-800x600.jpg" srcset="set-400w.jpg 400w" alt="L">'].join('\n'),
    'https://news.example/a'
  );
  assert.deepEqual(page.images.map((image) => image.url), ['https://news.example/lazy-800x600.jpg']);
  const emptyDataSrc = extractPage(
    ['<title>Yard</title>', '<p>Тэкст.</p>', '<img data-src="" src="real-800x600.jpg" alt="E">'].join('\n'),
    'https://news.example/a'
  );
  assert.deepEqual(
    emptyDataSrc.images.map((image) => image.url),
    ['https://news.example/real-800x600.jpg'],
    'an empty data-src falls back to the visible src'
  );
});

test('G17.10: an <img> inside script, template or noscript bodies is not a page image', () => {
  const page = extractPage(
    [
      '<title>Yard</title>',
      "<script>document.write('<img src=\"code-800x600.png\">');</script>",
      '<template><img src="tpl-800x600.png" alt="tpl"></template>',
      '<noscript><img src="real-800x600.jpg" alt="fallback"></noscript>',
      '<p>Тэкст.</p>',
    ].join('\n'),
    'https://news.example/a'
  );
  assert.deepEqual(page.images, [], 'invisible bodies never yield images; noscript repeats the lazy image it falls back for');
});

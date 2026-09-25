// Cleaning rule packages (G17.06): data tables per source type, applied by the
// generic engine in clean.mjs (docs/24_web_collection.md «Ачыстка»: «Правілы
// збіраюцца ў пакеты па тыпу крыніцы… з версіямі»). Changing the rules means
// bumping `version` — the old cleaned versions stay on disk, the next run
// writes the next version (cleanRecord). Each pattern here has an isolating
// fixture in clean.test.mjs: a rule without a failing-on-removal test does not
// exist (implementation-rules 14).
//
// Package names follow the spec's list: news-v1, wiki-v1, youtube-v1. The
// schema's 'web' type (crawl snapshots) shares the news package — the same
// article-page family.
export const PACKAGES = {
  news: {
    name: 'news',
    version: 1,
    // A paragraph matching any pattern is non-content, dropped whole. Drop
    // patterns must not carry the /g flag (they run through .test, whose
    // lastIndex would leak between paragraphs). Word ends use the
    // (?![\p{L}]) lookahead, not \b: JavaScript \b is ASCII-only and never
    // matches after a Cyrillic letter.
    drop: [
      /^\s*(?:меню|навігацыя|navigation|menu)\s*[|·•:]/iu,
      /^\s*(?:рэклама|advertis\w*|promo)(?![\p{L}])/iu,
      /^\s*(?:чытайце таксама|таксама цікава|падрабязней|read also|read more|related (?:articles|stories))(?![\p{L}])\s*:?/iu,
    ],
    // Inline rewrites applied to every kept paragraph.
    strip: [],
  },
  wiki: {
    name: 'wiki',
    version: 1,
    drop: [/^\s*(?:гл\. таксама|see also|zobacz też)\s*:/iu],
    strip: [/\s*\[\d+\]/g],
  },
  youtube: {
    name: 'youtube',
    version: 1,
    // A paragraph that is nothing but a stage direction — transcript
    // paragraphs always carry the [HH:MM:SS] start anchor (renderTranscript),
    // the optional prefix keeps the rule working on bare-direction text too.
    drop: [/^(?:\[\d{2}:\d{2}:\d{2}\]\s*)?[\[(](?:музыка|music|аплодзіменты|applause|смех|laughter)[\])]\s*\.?\s*$/iu],
    strip: [],
  },
};

// The mapping table is closed over the schema's source_type CHECK
// (store.mjs): any value the database can hold resolves here, anything else
// is a corrupt record and answers with a named diagnostic.
const TYPE_TO_PACKAGE = { news: 'news', web: 'news', wiki: 'wiki', youtube: 'youtube' };

export function packageForType(sourceType, packages = PACKAGES) {
  const name = TYPE_TO_PACKAGE[sourceType];
  if (!name) throw new Error(`no cleaning package for source type '${sourceType}'`);
  const pkg = packages[name];
  if (!pkg) throw new Error(`cleaning package '${name}' is missing from the registry`);
  return pkg;
}

// The full package name as it appears in the run log and the cleaned
// document's front matter.
export function packageName(pkg) {
  return `${pkg.name}-v${pkg.version}`;
}

// G14.04.d (issue #305, AC2) — no screen or component renders a word from
// its own source: every visible line rides the string catalogs (be/en/uk —
// 09 §8: «ніводнага зашытага радка нідзе»; the uk-release-scope §3.1 third
// file keeps the rule over the new vocabulary). The guard scans the
// production rendering zones for the two shapes a hardcoded word takes in
// this codebase — a single-line JSX text node and a word-bearing string
// literal on the word-carrying props — and fails naming the file and the
// literal. Adding an English (or any-language) literal to a screen fails
// here: the reverted-line check of implementation-rules 1. The catalogs'
// own files are the exception by design — they ARE the words.
import { describe, expect, test } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function collectTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) {
      out.push(join(entry.parentPath, entry.name));
    }
  }
  return out;
}

// A single-line JSX text node: the `>` closing a tag (preceded by a name
// char, a brace or a quote — not `=>` or a comparison) with letter-bearing
// text before the next `<`. Expressions ({...}) break the span, so bound
// words never match.
const JSX_TEXT = /(?<=[A-Za-z0-9_}"])>([^<>{}\n]*[A-Za-zА-Яа-яЁёЎўІЇЄҐ][^<>{}\n]*)</g;
// A string literal on the props the components read as visible/screen-reader
// words: any letter-bearing value fails — a single English word rides no
// exception (the codebase carries zero literal values on these props; a
// legit new word belongs to the catalogs).
const WORD_PROP = /\b(?:label|text|title|hint)\s*=\s*"([^"]*)"/g;
const LETTERS = /[A-Za-zА-Яа-яЁёЎўІЇЄҐіїєґ]/;

describe("no hardcoded words in the rendering zones (G14.04.d AC2)", () => {
  const files = [
    ...collectTsx(join(process.cwd(), "app")),
    ...collectTsx(join(process.cwd(), "components")),
  ];

  test("the production rendering zones exist to scan", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  test("no screen renders a literal word — words ride the catalogs", () => {
    const hits: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(JSX_TEXT)) {
        hits.push(`${file}: JSX text «${match[1]}»`);
      }
      for (const match of source.matchAll(WORD_PROP)) {
        if (LETTERS.test(match[1])) {
          hits.push(`${file}: prop literal «${match[1]}»`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});

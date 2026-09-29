// G06.05 (issue #280) — the shared UI words catalog: both locales carry the
// same keys with non-empty words (a string added to one language only fails
// here — the reverted-line check of implementation-rules 1), and the canon
// wordings the contracts name stay verbatim (11 §7's denied-GPS line rides
// runMapStrings, this file owns the chrome).
import { describe, expect, test } from "@jest/globals";

import { uiStrings } from "./ui-strings";

const keyShape = (locale: string): string =>
  Object.keys(uiStrings(locale))
    .sort()
    .join(",");

describe("uiStrings (G06.05 AC1)", () => {
  test("both locales carry the same keys", () => {
    expect(keyShape("be")).toBe(keyShape("en"));
    expect(keyShape("be").length).toBeGreaterThan(10);
  });

  test("no word is empty in either locale", () => {
    for (const locale of ["be", "en"]) {
      const strings = uiStrings(locale) as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(strings)) {
        // The label prefix names the failing word — this jest build's expect
        // takes no message argument.
        const label = `${locale}.${key}`;
        if (typeof value === "string") {
          expect(`${label}:${value.length > 0}`).toBe(`${label}:true`);
        }
        if (typeof value === "function") {
          // The parameterized lines render non-empty words for sample data —
          // each signature gets its own sample (the locales lines take
          // arrays, the counts take numbers).
          const locales = ["be"] as const;
          const rendered =
            key === "languagesLine"
              ? (value as (t: readonly string[]) => string)(locales)
              : key === "textAudioLine"
                ? (value as (t: readonly string[], a: readonly string[]) => string)(locales, locales)
                : key === "liveRowLine"
                  ? (value as (s: string, d: string, h: number) => string)("прыпыненая", "2026-09-29", 2)
                  : key === "pastRowLine"
                    ? (value as (a: string, b: string | null, h: number) => string)("2026-09-28", null, 1)
                    : key === "switchConfirm"
                      ? (value as (a: string, b: string) => string)("А", "Б")
                      : (value as (n: number) => string)(3);
          expect(`${label}:${rendered.length > 0}`).toBe(`${label}:true`);
        }
        if (value !== null && typeof value === "object") {
          for (const [sub, subValue] of Object.entries(value)) {
            expect(`${label}.${sub}:${String(subValue).length > 0}`).toBe(`${label}.${sub}:true`);
          }
        }
      }
    }
  });

  test("an unknown locale falls back to Belarusian, the first preference", () => {
    expect(uiStrings("uk").back).toBe(uiStrings("be").back);
    expect(uiStrings("en").back).not.toBe(uiStrings("be").back);
  });
});

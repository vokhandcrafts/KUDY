// G06.05 (issue #280) — the shared UI words catalog: every locale carries the
// same keys with non-empty words (a string added to one language only fails
// here — the reverted-line check of implementation-rules 1), and the canon
// wordings the contracts name stay verbatim (11 §7's denied-GPS line rides
// runMapStrings, this file owns the chrome). G14.04.d (issue #305) adds uk
// beside be/en — the same key set, the same non-empty rule.
import { describe, expect, test } from "@jest/globals";

import { uiStrings } from "./ui-strings";

const LOCALES = ["be", "en", "uk"] as const;

const keyShape = (locale: string): string =>
  Object.keys(uiStrings(locale))
    .sort()
    .join(",");

describe("uiStrings (G06.05 AC1)", () => {
  test("all three locales carry the same keys", () => {
    expect(keyShape("be")).toBe(keyShape("en"));
    // G14.04.d (issue #305): the third file rides the same key set.
    expect(keyShape("be")).toBe(keyShape("uk"));
    expect(keyShape("be").length).toBeGreaterThan(10);
  });

  test("no word is empty in any locale", () => {
    for (const locale of LOCALES) {
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
    // G14.04.d: uk has its own catalog now — the unknown-locale fallback is
    // asserted on a locale no catalog answers. G21.10 (issue #544): de has
    // its own German catalogue too, so the probe moved to the still-planned
    // «es» — and de now asserts its own honest German words. G21.11 (issue
    // #545): es owns a Spanish catalogue now, so the probe moves again to
    // the still-planned «fr». The discriminator is a word the languages do
    // not share («Назад» is the same word in be and uk).
    expect(uiStrings("fr").loading).toBe(uiStrings("be").loading);
    expect(uiStrings("en").loading).not.toBe(uiStrings("be").loading);
    expect(uiStrings("uk").loading).not.toBe(uiStrings("be").loading);
    expect(uiStrings("de").loading).toBe("Wird geladen…");
    expect(uiStrings("es").loading).toBe("Cargando…");
  });

  // G06.10 (issue #433): the My history reason line obeys the same outward
  // formatting rule as the controller reason dictionaries (the phrase rule
  // guarded in controllers/reason-strings.test.ts) — a capital letter and a
  // period in every locale; a revert to the period-less wording fails here.
  // G14.04.d: the capital class carries the Ukrainian І/Ї/Є/Ґ — uk's line
  // starts with «І».
  test("the history reason line reads as a phrase (be+en+uk)", () => {
    for (const locale of LOCALES) {
      const line = uiStrings(locale).historyUnavailable;
      expect(`${locale}:${/^[A-ZА-ЯЁЎІЇЄҐ]/.test(line)}`).toBe(`${locale}:true`);
      expect(`${locale}:${line.endsWith(".")}`).toBe(`${locale}:true`);
    }
  });
});

// G21.09 (issue #542, criterion 1) — the one UI-locale registry. The eight
// requested UI codes and their native names are defined here and nowhere
// else: a language is never named through a translation (the same self-name
// words every catalog used before this registry existed). This vocabulary is
// the UI display language only — it is deliberately a different thing from
// the published content-locale allowlist in
// contracts/schemas/localized-text.schema.json (which locales the guide
// content ships in) and must not gain content-availability semantics.
//
// «Complete» (criterion 4) means every message domain of
// contracts/ui-messages/source.json has a full typed catalogue for the code
// today: be, en, uk, de (G21.10, issue #544), es (G21.11, issue #545),
// fr (G21.12, issue #546), cs (G21.13, issue #547), sv (G21.14, issue #548)
// and zh (G21.46, issue #670) — all eight requested codes plus the Chinese
// release are complete. The selector and picker adapters advertise the OPEN
// subset (G21.50, issue #711) — today the eight released codes, because zh is
// complete yet closed until the release flag names it. The adapter vocabulary
// is never anything else.
//
// The Chinese native name is stored as \uXXXX escapes so the committed
// repository bytes stay CJK-free (G21.40 pattern, criterion 7); the runtime
// value carries the real glyphs.

export type UiLocaleCode = "be" | "en" | "uk" | "de" | "es" | "fr" | "cs" | "sv" | "zh";

// The codes whose catalogues are complete today (criterion 4): the subset of
// UiLocaleCode the adapters may advertise.
export type CompleteUiLocaleCode = Extract<UiLocaleCode, "be" | "en" | "uk" | "de" | "es" | "fr" | "cs" | "sv" | "zh">;

export interface UiLocaleEntry {
  readonly code: UiLocaleCode;
  readonly nativeName: string;
}

// Issue #542 criterion 1: the eight requested UI codes and native names,
// defined once — zh joins as the ninth code with the G21.46 catalogue.
export const UI_LOCALES: readonly UiLocaleEntry[] = [
  { code: "be", nativeName: "Беларуская" },
  { code: "en", nativeName: "English" },
  { code: "uk", nativeName: "Українська" },
  { code: "de", nativeName: "Deutsch" },
  { code: "es", nativeName: "Español" },
  { code: "fr", nativeName: "Français" },
  { code: "cs", nativeName: "Čeština" },
  { code: "sv", nativeName: "Svenska" },
  { code: "zh", nativeName: "\u7B80\u4F53\u4E2D\u6587" },
];

// The registered complete catalogues (criterion 4): what the selector and
// picker may expose. G21.12–G21.14 extend this list as each language's
// catalogue lands — the registry entry and the catalogue arrive together
// (de joined with the G21.10 catalogue, issue #544; es joins with the
// G21.11 catalogue, issue #545; fr with the G21.12 catalogue, issue #546;
// cs with the G21.13 catalogue, issue #547; sv with the G21.14 catalogue,
// issue #548; zh with the G21.46 catalogue, issue #670).
export const COMPLETE_UI_LOCALES: readonly CompleteUiLocaleCode[] = ["be", "en", "uk", "de", "es", "fr", "cs", "sv", "zh"];

export function isUiLocaleCode(value: string): value is UiLocaleCode {
  return UI_LOCALES.some((entry) => entry.code === value);
}

export function isCompleteUiLocale(value: string): value is CompleteUiLocaleCode {
  return (COMPLETE_UI_LOCALES as readonly string[]).includes(value);
}

// G21.50 (issue #711): the open subset the pickers advertise is a separate
// fact from COMPLETE_UI_LOCALES — a code may be complete and still closed.
// The frozen default is the G21.50 decision set: the eight advertised codes
// stay open under every flag state (hiding any of them is out of scope),
// and a code registered complete after this decision (zh first, G21.42 §11)
// stays closed until the flag names it.
const RELEASE_DEFAULT_OPEN: readonly CompleteUiLocaleCode[] = ["be", "en", "uk", "de", "es", "fr", "cs", "sv"];

// The one build/deploy input that names additionally open codes (additive,
// comma- or whitespace-separated; `zh` once its catalogue lands). No flag
// vendor, no second input name.
export const RELEASE_FLAG_ENV = 'EXPO_PUBLIC_OPEN_UI_LOCALES';

// Pure resolver: the default set intersected with `complete`, plus every
// flag-named code that `complete` registers. Absent, empty or corrupt input
// (unknown tokens, stray separators) answers with the default set — never a
// throw, never a removal of the default codes. The `complete` parameter is
// the tests' seam; production always evaluates against the real registry.
export function releaseOpenUiLocales(
  flagValue: string | null | undefined,
  complete: readonly CompleteUiLocaleCode[] = COMPLETE_UI_LOCALES,
): readonly CompleteUiLocaleCode[] {
  const open: CompleteUiLocaleCode[] = RELEASE_DEFAULT_OPEN.filter((code) => complete.includes(code));
  if (typeof flagValue !== 'string') {
    return open;
  }
  const known: readonly string[] = complete;
  const taken: readonly string[] = open;
  for (const token of flagValue.split(/[,\s]+/)) {
    if (token !== '' && !taken.includes(token) && known.includes(token)) {
      open.push(token as CompleteUiLocaleCode);
    }
  }
  return open;
}

// The module-level fact the surfaces read. The value is read once here at
// module evaluation: Metro inlines EXPO_PUBLIC_* into the app binary, the
// Next static export evaluates it at build time, node tests see the real
// environment. A bundle that cannot inline it (a web client chunk) reads
// undefined — the same absent-flag case, so it falls back to the default.
export const OPEN_UI_LOCALES: readonly CompleteUiLocaleCode[] = releaseOpenUiLocales(process.env[RELEASE_FLAG_ENV]);

// The complete locales' native names as a keyed record for the chrome
// catalogs: the catalogs embed this object so the self-name words live only
// in the registry table above.
export function completeUiLocaleSelfNames(): Record<CompleteUiLocaleCode, string> {
  const names = {} as Record<CompleteUiLocaleCode, string>;
  for (const code of COMPLETE_UI_LOCALES) names[code] = uiLocaleNativeName(code);
  return names;
}

// The native name from the one registry table (criterion 1: defined once —
// adapters render names from here, not from their own copies).
export function uiLocaleNativeName(code: UiLocaleCode): string {
  const entry = UI_LOCALES.find((candidate) => candidate.code === code);
  if (!entry) {
    throw new Error(`ui-locale-unregistered: ${code}`);
  }
  return entry.nativeName;
}

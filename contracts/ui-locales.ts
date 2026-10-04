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
// today: be, en and uk. de/es/fr/cs/sv are registered for the future
// languages (G21.10–G21.14) but have no catalogues yet — the selector and
// picker adapters advertise only the complete subset, never a planned code.

export type UiLocaleCode = "be" | "en" | "uk" | "de" | "es" | "fr" | "cs" | "sv";

// The codes whose catalogues are complete today (criterion 4): the subset of
// UiLocaleCode the adapters may advertise.
export type CompleteUiLocaleCode = Extract<UiLocaleCode, "be" | "en" | "uk">;

export interface UiLocaleEntry {
  readonly code: UiLocaleCode;
  readonly nativeName: string;
}

// Issue #542 criterion 1 verbatim: the eight requested UI codes and native
// names, defined once.
export const UI_LOCALES: readonly UiLocaleEntry[] = [
  { code: "be", nativeName: "Беларуская" },
  { code: "en", nativeName: "English" },
  { code: "uk", nativeName: "Українська" },
  { code: "de", nativeName: "Deutsch" },
  { code: "es", nativeName: "Español" },
  { code: "fr", nativeName: "Français" },
  { code: "cs", nativeName: "Čeština" },
  { code: "sv", nativeName: "Svenska" },
];

// The registered complete catalogues (criterion 4): what the selector and
// picker may expose. G21.10–G21.14 extend this list as each language's
// catalogue lands — the registry entry and the catalogue arrive together.
export const COMPLETE_UI_LOCALES: readonly CompleteUiLocaleCode[] = ["be", "en", "uk"];

export function isUiLocaleCode(value: string): value is UiLocaleCode {
  return UI_LOCALES.some((entry) => entry.code === value);
}

export function isCompleteUiLocale(value: string): value is CompleteUiLocaleCode {
  return (COMPLETE_UI_LOCALES as readonly string[]).includes(value);
}

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

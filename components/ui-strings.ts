// G06.05 (issue #280) — the shared UI words of the G06 surfaces, BE/EN per
// the row's first criterion. G14.04.d (issue #305) adds the third catalog:
// uk rides the same mechanism beside be/en (uk-release-scope §3.1 — "тая ж
// сістэма, новы набор"), with the catalog keys kept equivalent by the
// parity guard. The catalogs here are presentation-only chrome
// (back labels, loading, the catalog state words, the KUDY surface sections,
// the preview facts line); domain words with diagnostics stay with their
// controllers (runMapStrings, placeDetailStrings, previewStrings). The
// locale argument is the composition root's display locale — the first
// preference of createServices, switchable through its ui-locale store
// (the L02 selection this row deferred to G14.04.d); an unknown locale
// falls back to Belarusian, the app's first preference (the runMapStrings
// idiom). G21.09 (issue #542, criterion 2) — the UiStrings/AccessKind shapes
// moved to the shared pure contract zone (contracts/ui-message-types.ts) and
// re-exported here. G21.25 (issue #558) — the words themselves are the
// generated projection in ui-strings.generated.ts (the canonical records +
// the reviewed translations): this adapter keeps the selector and the type
// re-exports only; the base text never lives in a hand-maintained file.

import type { AccessKind, UiStrings } from "../contracts/ui-message-types.ts";
import { UI_STRINGS } from "./ui-strings.generated.ts";

export type { AccessKind, UiStrings } from "../contracts/ui-message-types.ts";

export function uiStrings(locale: string): UiStrings {
  return locale === "cs" ? UI_STRINGS.cs : locale === "es" ? UI_STRINGS.es : locale === "fr" ? UI_STRINGS.fr : locale === "de" ? UI_STRINGS.de : locale === "en" ? UI_STRINGS.en : locale === "uk" ? UI_STRINGS.uk : UI_STRINGS.be;
}

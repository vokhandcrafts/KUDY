// GENERATED FILE — do not edit. Regenerate with:
//   node --experimental-strip-types tools/i18n/generate-messages.mjs
//
// Source of truth: contracts/ui-messages/source.json (the be base text) and
// contracts/ui-messages/translations/<locale>.json (the reviewed translations).
// G21.25 (issue #558): the catalogues are generated projections — edit the
// source/translation data, never this file; the generator's --check mode
// fails on any hand edit.
// the nearby guide-hint card's words (G07.05 #284); uk keeps the documented be fallback (uk-release-scope §6.4) until its words are authored, de renders its own catalogue (G21.10 #544), es too (G21.11 #545), fr too (G21.12 #546)

import type { GuideHintStrings } from "../contracts/ui-message-types.ts";

export const GUIDE_HINT_STRINGS: Record<"be" | "en" | "de" | "es" | "fr", GuideHintStrings> = {
  "be": {
    "dismiss": "Схаваць",
    "heading": "Побач ёсць гід…",
    "openHint": "Адкрыць апісанне гіда",
    "paid": "платны",
  },
  "en": {
    "dismiss": "Hide",
    "heading": "A guide is nearby…",
    "openHint": "Open the guide's description",
    "paid": "paid",
  },
  "de": {
    "dismiss": "Ausblenden",
    "heading": "In der Nähe gibt es einen Guide…",
    "openHint": "Guide-Beschreibung öffnen",
    "paid": "kostenpflichtig",
  },
  "es": {
    "dismiss": "Ocultar",
    "heading": "Cerca hay una guía…",
    "openHint": "Abrir la descripción de la guía",
    "paid": "de pago",
  },
  "fr": {
    "dismiss": "Masquer",
    "heading": "Il y a un guide à proximité…",
    "openHint": "Ouvrir la description du guide",
    "paid": "payant",
  },
};

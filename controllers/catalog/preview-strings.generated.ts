// GENERATED FILE — do not edit. Regenerate with:
//   node --experimental-strip-types tools/i18n/generate-messages.mjs
//
// Source of truth: contracts/ui-messages/source.json (the be base text) and
// contracts/ui-messages/translations/<locale>.json (the reviewed translations).
// G21.25 (issue #558): the catalogues are generated projections — edit the
// source/translation data, never this file; the generator's --check mode
// fails on any hand edit.
// the guide preview's words (G06.05 #280, AC4/AC5; G08.05 #292)


export const PREVIEW_STRINGS_DATA = {
  "be": {
    "detail": (detail: { readonly kind: string; readonly count?: number }) => detail.kind === "damaged" ? `пакет пашкоджаны: патрэбна паўторная загрузка` : detail.kind === "missing-files" ? `не хапае файлаў: ${detail.count}` : detail.kind === "stale" ? `даступна абнаўленне` : `пакет няпоўны`,
    "downloadFailed": "Збой загрузкі.",
    "label": {
      "download": "Загрузіць",
      "start": "Пачаць",
    },
    "reason": {
      "preview#download-unavailable": "Загрузка недаступная на гэтай зборцы.",
      "preview#not-published": "Гід не апублікаваны.",
      "preview#purchase-required": "Патрэбна пакупка.",
      "preview#storage-unknown": "Сховішча недаступнае.",
      "preview#verify-unavailable": "Праверка недаступная.",
    },
    "retry": "Паўтарыць",
    "storageExit": "Вызваліць месца ў KUDY",
    "storageFullDetail": (mb: number) => `не хапае месца: патрэбна яшчэ ${mb} МБ`,
  },
  "en": {
    "detail": (detail: { readonly kind: string; readonly count?: number }) => detail.kind === "damaged" ? `package damaged: re-download needed` : detail.kind === "missing-files" ? `missing files: ${detail.count}` : detail.kind === "stale" ? `an update is available` : `package incomplete`,
    "downloadFailed": "Download failed.",
    "label": {
      "download": "Download",
      "start": "Start",
    },
    "reason": {
      "preview#download-unavailable": "Download unavailable in this build.",
      "preview#not-published": "Guide not published.",
      "preview#purchase-required": "Purchase required.",
      "preview#storage-unknown": "Storage unavailable.",
      "preview#verify-unavailable": "Verification unavailable.",
    },
    "retry": "Retry",
    "storageExit": "Free up space in KUDY",
    "storageFullDetail": (mb: number) => `not enough space: ${mb} MB more needed`,
  },
  "uk": {
    "detail": (detail: { readonly kind: string; readonly count?: number }) => detail.kind === "damaged" ? `пакет пошкоджений: потрібне повторне завантаження` : detail.kind === "missing-files" ? `бракує файлів: ${detail.count}` : detail.kind === "stale" ? `доступне оновлення` : `пакет неповний`,
    "downloadFailed": "Збій завантаження.",
    "label": {
      "download": "Завантажити",
      "start": "Почати",
    },
    "reason": {
      "preview#download-unavailable": "Завантаження недоступне в цьому складанні.",
      "preview#not-published": "Гід не опублікований.",
      "preview#purchase-required": "Потрібна покупка.",
      "preview#storage-unknown": "Сховище недоступне.",
      "preview#verify-unavailable": "Перевірка недоступна.",
    },
    "retry": "Повторити",
    "storageExit": "Звільнити місце в KUDY",
    "storageFullDetail": (mb: number) => `бракує місця: потрібно ще ${mb} МБ`,
  },
  "de": {
    "detail": (detail: { readonly kind: string; readonly count?: number }) => detail.kind === "damaged" ? `Paket beschädigt: erneutes Laden nötig` : detail.kind === "missing-files" ? `Fehlende Dateien: ${detail.count}` : detail.kind === "stale" ? `Ein Update ist verfügbar` : `Paket unvollständig`,
    "downloadFailed": "Laden fehlgeschlagen.",
    "label": {
      "download": "Laden",
      "start": "Starten",
    },
    "reason": {
      "preview#download-unavailable": "Laden ist in diesem Build nicht verfügbar.",
      "preview#not-published": "Guide ist nicht veröffentlicht.",
      "preview#purchase-required": "Kauf erforderlich.",
      "preview#storage-unknown": "Speicher nicht verfügbar.",
      "preview#verify-unavailable": "Prüfung nicht verfügbar.",
    },
    "retry": "Erneut versuchen",
    "storageExit": "Speicher in KUDY freigeben",
    "storageFullDetail": (mb: number) => `nicht genug Speicher: ${mb} MB mehr erforderlich`,
  },
};

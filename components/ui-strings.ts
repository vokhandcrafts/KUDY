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
// re-exported here; the catalogs stay the presentation data, keyed by the
// complete UI locales of contracts/ui-locales.ts.

import type { AccessKind, UiStrings } from "../contracts/ui-message-types.ts";
import { completeUiLocaleSelfNames, type CompleteUiLocaleCode } from "../contracts/ui-locales.ts";

export type { AccessKind, UiStrings } from "../contracts/ui-message-types.ts";

const STRINGS: Record<CompleteUiLocaleCode, UiStrings> = {

  be: {
    // G06.10 (issue #432): the back words carry no text arrow — the one
    // arrow image is the Lucide glyph BackButton renders; the word alone is
    // both the visible caption and the screen-reader label.
    back: "Назад",
    backToCity: "Горад",
    notFoundTitle: "Такога экрана няма",
    notFoundHint: "Каталог чакае — вяртайцеся да яго кнопкай «Назад».",
    loading: "Загрузка…",
    walk: "Прагулка",
    nearby: "Побач →",
    guidesLink: "Гіды →",
    kudyLink: "KUDY →",
    retry: "Паўтарыць",
    catalogUnavailable: "Каталог недаступны",
    catalogTemporarilyUnavailable: "Каталог часова недаступны",
    notPublished: "не апублікавана",
    validCache: "Папярэдні валідны кэш",
    previewUnavailable: "Прэв'ю часова недаступны",
    degradedData: "Частка звестак часова недаступная",
    myKudy: "KUDY",
    historyUnavailable: "Гісторыя недаступная.",
    currentWalk: "Бягучая прагулка",
    noCurrentWalk: "Бягучай прагулкі няма",
    pastWalks: "Папярэднія праходы",
    noPastWalks: "Папярэдніх праходаў няма",
    stateLabel: { active: "актыўная", paused: "прыпыненая", finished: "завершаная" },
    heardCount: (count) => `праслышана: ${count}`,
    liveRowLine: (state, day, heard) => `${state} — з ${day} — праслышана: ${heard}`,
    pastRowLine: (startedDay, finishedDay, heard) =>
      `${startedDay} — ${finishedDay ?? "—"} — праслышана: ${heard}`,
    access: { free: "Бясплатна", paid: "Платна", mixed: "Змешана" },
    languagesLine: (textLocales) => `Мовы: ${textLocales.join(", ")}`,
    textAudioLine: (textLocales, audioLocales) =>
      `Тэкст: ${textLocales.join(", ")}${audioLocales.length > 0 ? `; аўдыё: ${audioLocales.join(", ")}` : ""}`,
    stopsCount: (count) => `Кропкі: ${count}`,
    sizeMb: (mb) => `Памер: ${mb} МБ`,
    freeStopsCount: (count) => `Кропак бясплатна: ${count}`,
    stopNumber: (position) => `Кропка ${position}`,
    durationLabel: "Працягласць",
    stopsLabel: "Кропкі",
    locked: "Зачынена",
    durationRange: (minMinutes, maxMinutes) => `Час: ад ${minMinutes} да ${maxMinutes} хв`,
    durationMinutes: (minutes) => `Час: ${minutes} хв`,
    switchConfirm: (liveTitle, candidateTitle) => `Завяршыць «${liveTitle}» і пачаць «${candidateTitle}»?`,
    switchAccept: "Завершыць і пачаць",
    cancel: "Скасаваць",
    whatToDo: "Чым заняцца →",
    discoveryTitle: "Чым заняцца",
    discoveryUnavailable: "Падбор недаступны",
    discoveryTemporarilyUnavailable: "Падбор зараз недаступны",
    discoveryEmpty: "Нічога дакладна не падыходзіць — пасмякчыце выбар або паглядзіце іншыя варыянты.",
    discoveryAlternatives: "Іншыя варыянты",
    collectionUnavailable: "Падборка недаступная",
    collectionUnresolved: "Некаторыя члены падборкі пакуль не апублікаваныя.",
    timeUnlimited: "Без абмежавання",
    timeCap: (minutes) =>
      minutes === 60 ? "Да гадзіны" : minutes === 120 ? "Да дзвюх гадзін" : minutes === 240 ? "На паўдня" : `Да ${minutes} хв`,
    seasonName: { spring: "Вясна", summer: "Лета", autumn: "Восень", winter: "Зіма" },
    reasonText: {
      editorial: "рэдакцыйны выбар",
      theme_match: "тэма",
      within_time: "падыходзіць па часе",
      season_recommended: "рэкамендавана на гэты сезон",
    },
    differenceText: {
      duration_unknown: "час не ацэнены",
      over_time: "даўжэй за запыт",
      theme_mismatch: "іншая тэма",
      season_unassessed: "сезон не ацэнены",
      season_not_recommended: "не для гэтага сезону",
    },
    languageLabel: "Мова",
    // The self-name words come from the one locale registry (G21.09): the
    // same native words in every catalog, defined once in contracts.
    languageSelfNames: completeUiLocaleSelfNames(),
  },
  en: {
    back: "Back",
    backToCity: "City",
    notFoundTitle: "No such screen",
    notFoundHint: "The catalog is waiting — use «Back» to return to it.",
    loading: "Loading…",
    walk: "Walk",
    nearby: "Nearby →",
    guidesLink: "Guides →",
    kudyLink: "KUDY →",
    retry: "Retry",
    catalogUnavailable: "Catalog unavailable",
    catalogTemporarilyUnavailable: "Catalog temporarily unavailable",
    notPublished: "not published",
    validCache: "Previous valid cache",
    previewUnavailable: "Preview temporarily unavailable",
    degradedData: "Some data temporarily unavailable",
    myKudy: "KUDY",
    historyUnavailable: "History unavailable.",
    currentWalk: "Current walk",
    noCurrentWalk: "No current walk",
    pastWalks: "Previous walks",
    noPastWalks: "No previous walks",
    stateLabel: { active: "active", paused: "paused", finished: "finished" },
    heardCount: (count) => `heard: ${count}`,
    liveRowLine: (state, day, heard) => `${state} — from ${day} — heard: ${heard}`,
    pastRowLine: (startedDay, finishedDay, heard) =>
      `${startedDay} — ${finishedDay ?? "—"} — heard: ${heard}`,
    access: { free: "Free", paid: "Paid", mixed: "Mixed" },
    languagesLine: (textLocales) => `Languages: ${textLocales.join(", ")}`,
    textAudioLine: (textLocales, audioLocales) =>
      `Text: ${textLocales.join(", ")}${audioLocales.length > 0 ? `; audio: ${audioLocales.join(", ")}` : ""}`,
    stopsCount: (count) => `Stops: ${count}`,
    sizeMb: (mb) => `Size: ${mb} MB`,
    freeStopsCount: (count) => `Free stops: ${count}`,
    stopNumber: (position) => `Stop ${position}`,
    durationLabel: "Duration",
    stopsLabel: "Stops",
    locked: "Locked",
    durationRange: (minMinutes, maxMinutes) => `Time: ${minMinutes}–${maxMinutes} min`,
    durationMinutes: (minutes) => `Time: ${minutes} min`,
    switchConfirm: (liveTitle, candidateTitle) => `Finish “${liveTitle}” and start “${candidateTitle}”?`,
    switchAccept: "Finish and start",
    cancel: "Cancel",
    whatToDo: "What to do →",
    discoveryTitle: "What to do",
    discoveryUnavailable: "Discovery unavailable",
    discoveryTemporarilyUnavailable: "Discovery is temporarily unavailable",
    discoveryEmpty: "Nothing matches exactly — relax the choice or look at the other options.",
    discoveryAlternatives: "Other options",
    collectionUnavailable: "Collection unavailable",
    collectionUnresolved: "Some collection members are not published yet.",
    timeUnlimited: "No limit",
    timeCap: (minutes) =>
      minutes === 60 ? "Up to an hour" : minutes === 120 ? "Up to two hours" : minutes === 240 ? "Half a day" : `Up to ${minutes} min`,
    seasonName: { spring: "Spring", summer: "Summer", autumn: "Autumn", winter: "Winter" },
    reasonText: {
      editorial: "editorial pick",
      theme_match: "theme",
      within_time: "fits the time",
      season_recommended: "recommended for the season",
    },
    differenceText: {
      duration_unknown: "duration not assessed",
      over_time: "longer than asked",
      theme_mismatch: "different theme",
      season_unassessed: "season not assessed",
      season_not_recommended: "not for this season",
    },
    languageLabel: "Language",
    // The self-name words come from the one locale registry (G21.09): the
    // same native words in every catalog, defined once in contracts.
    languageSelfNames: completeUiLocaleSelfNames(),
  },
  uk: {
    // G14.04.d (issue #305) — the third catalog (uk-release-scope §3.1). The
    // lines are the agent's rendering of the same facts the be/en words name;
    // the native-speaker review is the owner's (uk-release-scope §5, §6.4).
    back: "Назад",
    backToCity: "Місто",
    notFoundTitle: "Такого екрана немає",
    notFoundHint: "Каталог чекає — повертайтеся до нього кнопкою «Назад».",
    loading: "Завантаження…",
    walk: "Прогулянка",
    nearby: "Поруч →",
    guidesLink: "Гіди →",
    kudyLink: "KUDY →",
    retry: "Повторити",
    catalogUnavailable: "Каталог недоступний",
    catalogTemporarilyUnavailable: "Каталог тимчасово недоступний",
    notPublished: "не опубліковано",
    validCache: "Попередній валідний кеш",
    previewUnavailable: "Прев'ю тимчасово недоступне",
    degradedData: "Частина даних тимчасово недоступна",
    myKudy: "KUDY",
    historyUnavailable: "Історія недоступна.",
    currentWalk: "Поточна прогулянка",
    noCurrentWalk: "Поточної прогулянки немає",
    pastWalks: "Попередні прогулянки",
    noPastWalks: "Попередніх прогулянок немає",
    stateLabel: { active: "активна", paused: "призупинена", finished: "завершена" },
    heardCount: (count) => `прослухано: ${count}`,
    liveRowLine: (state, day, heard) => `${state} — з ${day} — прослухано: ${heard}`,
    pastRowLine: (startedDay, finishedDay, heard) =>
      `${startedDay} — ${finishedDay ?? "—"} — прослухано: ${heard}`,
    access: { free: "Безкоштовно", paid: "Платно", mixed: "Змішано" },
    languagesLine: (textLocales) => `Мови: ${textLocales.join(", ")}`,
    textAudioLine: (textLocales, audioLocales) =>
      `Текст: ${textLocales.join(", ")}${audioLocales.length > 0 ? `; аудіо: ${audioLocales.join(", ")}` : ""}`,
    stopsCount: (count) => `Точки: ${count}`,
    sizeMb: (mb) => `Розмір: ${mb} МБ`,
    freeStopsCount: (count) => `Точок безкоштовно: ${count}`,
    stopNumber: (position) => `Точка ${position}`,
    durationLabel: "Тривалість",
    stopsLabel: "Точки",
    locked: "Зачинено",
    durationRange: (minMinutes, maxMinutes) => `Час: від ${minMinutes} до ${maxMinutes} хв`,
    durationMinutes: (minutes) => `Час: ${minutes} хв`,
    switchConfirm: (liveTitle, candidateTitle) => `Завершити «${liveTitle}» і почати «${candidateTitle}»?`,
    switchAccept: "Завершити й почати",
    cancel: "Скасувати",
    whatToDo: "Чим зайнятися →",
    discoveryTitle: "Чим зайнятися",
    discoveryUnavailable: "Підбір недоступний",
    discoveryTemporarilyUnavailable: "Підбір зараз недоступний",
    discoveryEmpty: "Нічого точно не підходить — послабте вибір або подивіться інші варіанти.",
    discoveryAlternatives: "Інші варіанти",
    collectionUnavailable: "Підбірка недоступна",
    collectionUnresolved: "Деякі члени підбірки ще не опубліковані.",
    timeUnlimited: "Без обмеження",
    timeCap: (minutes) =>
      minutes === 60 ? "До години" : minutes === 120 ? "До двох годин" : minutes === 240 ? "На пів дня" : `До ${minutes} хв`,
    seasonName: { spring: "Весна", summer: "Літо", autumn: "Осінь", winter: "Зима" },
    reasonText: {
      editorial: "редакційний вибір",
      theme_match: "тема",
      within_time: "підходить за часом",
      season_recommended: "рекомендовано на цей сезон",
    },
    differenceText: {
      duration_unknown: "час не оцінено",
      over_time: "довше за запит",
      theme_mismatch: "інша тема",
      season_unassessed: "сезон не оцінено",
      season_not_recommended: "не для цього сезону",
    },
    languageLabel: "Мова",
    // The self-name words come from the one locale registry (G21.09): the
    // same native words in every catalog, defined once in contracts.
    languageSelfNames: completeUiLocaleSelfNames(),
  },
};

export function uiStrings(locale: string): UiStrings {
  return locale === "en" ? STRINGS.en : locale === "uk" ? STRINGS.uk : STRINGS.be;
}

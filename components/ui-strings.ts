// G06.05 (issue #280) — the shared UI words of the G06 surfaces, BE/EN per
// the row's first criterion. The catalogs here are presentation-only chrome
// (back labels, loading, the catalog state words, the KUDY surface sections,
// the preview facts line); domain words with diagnostics stay with their
// controllers (runMapStrings, placeDetailStrings, previewStrings). The
// locale argument is the composition root's display locale — the first
// preference of createServices (the UI-locale *selection* is L02 and stays
// out); an unknown locale falls back to Belarusian, the app's first
// preference (the runMapStrings idiom).

export type AccessKind = "free" | "paid" | "mixed";

export interface UiStrings {
  readonly back: string;
  readonly backToCity: string;
  // The unknown deep link's words (issue #427): the honest message and the
  // hint that names where the catalog is — the screen never renders dev text.
  readonly notFoundTitle: string;
  readonly notFoundHint: string;
  readonly loading: string;
  readonly walk: string;
  readonly nearby: string;
  readonly guidesLink: string;
  // The KUDY surface's Explore entry (issue #426): the owner's 2026-10-01
  // decision — the history surface is named «KUDY», not «My KUDY».
  readonly kudyLink: string;
  readonly retry: string;
  readonly catalogUnavailable: string;
  readonly catalogTemporarilyUnavailable: string;
  readonly notPublished: string;
  readonly validCache: string;
  readonly previewUnavailable: string;
  readonly degradedData: string;
  readonly myKudy: string;
  readonly historyUnavailable: string;
  readonly currentWalk: string;
  readonly noCurrentWalk: string;
  readonly pastWalks: string;
  readonly noPastWalks: string;
  readonly stateLabel: Record<"active" | "paused" | "finished", string>;
  readonly heardCount: (count: number) => string;
  // The My KUDY row lines (G06.05, AC1): the state word, the local days and
  // the heard count stay one sentence per locale — no hard-coded preposition.
  readonly liveRowLine: (state: string, day: string, heard: number) => string;
  readonly pastRowLine: (startedDay: string, finishedDay: string | null, heard: number) => string;
  readonly access: Record<AccessKind, string>;
  readonly languagesLine: (textLocales: readonly string[]) => string;
  readonly textAudioLine: (textLocales: readonly string[], audioLocales: readonly string[]) => string;
  readonly stopsCount: (count: number) => string;
  readonly sizeMb: (mb: number) => string;
  readonly freeStopsCount: (count: number) => string;
  readonly stopNumber: (position: number) => string;
  // The metadata-row icon words (G06.10.c, issue #403): the standalone
  // screen-reader label the icon contract requires — the fact line next to
  // the icon carries the value.
  readonly durationLabel: string;
  readonly stopsLabel: string;
  // The locked stop's badge word — the 🔒 never reads alone (AC1: the
  // screen-reader label is a word, the glyph is decoration).
  readonly locked: string;
  readonly durationRange: (minMinutes: number, maxMinutes: number) => string;
  readonly durationMinutes: (minutes: number) => string;
  readonly switchConfirm: (liveTitle: string, candidateTitle: string) => string;
  readonly switchAccept: string;
  readonly cancel: string;
  // G15.03 (issue #70) — the discovery surfaces' chrome words (BE/EN): the
  // Explore entry, the honest states and the labeled facts of the offer
  // cards. The maps' fallback in the screens is the raw contract value — an
  // unknown reason, difference or season renders verbatim, never dropped.
  readonly whatToDo: string;
  readonly discoveryTitle: string;
  readonly discoveryUnavailable: string;
  readonly discoveryTemporarilyUnavailable: string;
  readonly discoveryEmpty: string;
  readonly discoveryAlternatives: string;
  readonly collectionUnavailable: string;
  readonly collectionUnresolved: string;
  readonly timeUnlimited: string;
  readonly timeCap: (minutes: number) => string;
  readonly seasonName: Record<string, string>;
  readonly reasonText: Record<string, string>;
  readonly differenceText: Record<string, string>;
}

const STRINGS: Record<"be" | "en", UiStrings> = {
  be: {
    back: "← Назад",
    backToCity: "← Горад",
    notFoundTitle: "Такога экрана няма",
    notFoundHint: "Каталог чакае — вяртайцеся да яго кнопкай «← Назад».",
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
  },
  en: {
    back: "← Back",
    backToCity: "← City",
    notFoundTitle: "No such screen",
    notFoundHint: "The catalog is waiting — use «← Back» to return to it.",
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
  },
};

export function uiStrings(locale: string): UiStrings {
  return locale === "en" ? STRINGS.en : STRINGS.be;
}

// G06.05 (issue #280) — the shared UI words of the G06 surfaces, BE/EN per
// the row's first criterion. The catalogs here are presentation-only chrome
// (back labels, loading, the catalog state words, the My KUDY sections, the
// preview facts line); domain words with diagnostics stay with their
// controllers (runMapStrings, placeDetailStrings, previewStrings). The
// locale argument is the composition root's display locale — the first
// preference of createServices (the UI-locale *selection* is L02 and stays
// out); an unknown locale falls back to Belarusian, the app's first
// preference (the runMapStrings idiom).

export type AccessKind = "free" | "paid" | "mixed";

export interface UiStrings {
  readonly back: string;
  readonly backToCity: string;
  readonly loading: string;
  readonly walk: string;
  readonly nearby: string;
  readonly guidesLink: string;
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
  // The locked stop's badge word — the 🔒 never reads alone (AC1: the
  // screen-reader label is a word, the glyph is decoration).
  readonly locked: string;
  readonly durationRange: (minMinutes: number, maxMinutes: number) => string;
  readonly durationMinutes: (minutes: number) => string;
  readonly switchConfirm: (liveTitle: string, candidateTitle: string) => string;
  readonly switchAccept: string;
  readonly cancel: string;
}

const STRINGS: Record<"be" | "en", UiStrings> = {
  be: {
    back: "← Назад",
    backToCity: "← Горад",
    loading: "Загрузка…",
    walk: "Прагулка",
    nearby: "Побач →",
    guidesLink: "Гіды →",
    retry: "Паўтарыць",
    catalogUnavailable: "Каталог недаступны",
    catalogTemporarilyUnavailable: "Каталог часова недаступны",
    notPublished: "не апублікавана",
    validCache: "Папярэдні валідны кэш",
    previewUnavailable: "Прэв'ю часова недаступны",
    degradedData: "Частка звестак часова недаступная",
    myKudy: "My KUDY",
    historyUnavailable: "Гісторыя недаступная",
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
    locked: "Зачынена",
    durationRange: (minMinutes, maxMinutes) => `Час: ад ${minMinutes} да ${maxMinutes} хв`,
    durationMinutes: (minutes) => `Час: ${minutes} хв`,
    switchConfirm: (liveTitle, candidateTitle) => `Завяршыць «${liveTitle}» і пачаць «${candidateTitle}»?`,
    switchAccept: "Завершыць і пачаць",
    cancel: "Скасаваць",
  },
  en: {
    back: "← Back",
    backToCity: "← City",
    loading: "Loading…",
    walk: "Walk",
    nearby: "Nearby →",
    guidesLink: "Guides →",
    retry: "Retry",
    catalogUnavailable: "Catalog unavailable",
    catalogTemporarilyUnavailable: "Catalog temporarily unavailable",
    notPublished: "not published",
    validCache: "Previous valid cache",
    previewUnavailable: "Preview temporarily unavailable",
    degradedData: "Some data temporarily unavailable",
    myKudy: "My KUDY",
    historyUnavailable: "History unavailable",
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
    locked: "Locked",
    durationRange: (minMinutes, maxMinutes) => `Time: ${minMinutes}–${maxMinutes} min`,
    durationMinutes: (minutes) => `Time: ${minutes} min`,
    switchConfirm: (liveTitle, candidateTitle) => `Finish “${liveTitle}” and start “${candidateTitle}”?`,
    switchAccept: "Finish and start",
    cancel: "Cancel",
  },
};

export function uiStrings(locale: string): UiStrings {
  return locale === "en" ? STRINGS.en : STRINGS.be;
}

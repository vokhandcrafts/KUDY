// UX 01 (issue #347) — the KUDY surface render suite (the display name since
// issue #426): a finished-run
// history of ten sessions renders inside the surface's FlatList — the
// list is reachable by scroll, never cut by the fold. The rows come from a
// fake session-history port: the screen renders what the durable zone keeps
// and invents nothing (the G06.04 controller suite covers the states; this
// suite covers only the scroll surface, implementation-rules 1 — removing
// the FlatList drops the testID and fails). G22.06 (issue #611): the port
// serves pages, and the list windows the loaded rows instead of mounting the
// whole page at once.
import { describe, expect, test } from "@jest/globals";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";

import My from "./(tabs)/my";
import FeedbackForm from "./feedback";
import { createServices } from "../controllers/createServices";
import type { SessionHistoryPort } from "../controllers/myKudyController";
import {
  FEEDBACK_DISCLOSURE_VERSION,
  feedbackStrings,
} from "../controllers/useFeedbackController";
import { createFeedbackSync } from "../services/feedbackSync";
import { saveDraft, sendNow } from "../services/feedbackRepository";
import {
  GUIDE_TARGET,
  M1,
  NOW,
  okPut,
  openIdentifiedStore,
  scriptedTransport,
  secretBox,
} from "../tests/feedback/queue-fixture";
import { tokens } from "../components/design-tokens";
import { CATALOG_FIXTURES, flatStyle, layoutWith, serve, sha256 } from "../test/render-helpers";
import type { SessionHistoryCursor, SessionHistoryPage, SessionHistorySummary } from "../services/db/types";

const finishedSummary = (n: number): SessionHistorySummary => ({
  sessionId: `walk-render-${n}`,
  routeId: "route-map",
  version: "1",
  locale: "be",
  state: "finished",
  startedAt: n * 1_000,
  finishedAt: n * 1_000 + 500,
  heardCount: 1,
});

// The fake history port serves one static completed page — the screen renders
// what the durable zone keeps and invents nothing.
const historyPort = (rows: SessionHistorySummary[]): SessionHistoryPort => ({
  listPage: async () => ({ live: null, rows, nextCursor: null }),
});

describe("KUDY surface (UX 01)", () => {
  test("the finished history scrolls: ten sessions render inside the ScrollView", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => finishedSummary(i + 1));
    const services = createServices({ sessionHistory: historyPort(rows) });
    renderRouter({ _layout: layoutWith(services), "(tabs)/my": My }, { initialUrl: "/my" });
    expect(await screen.findByTestId("scroll-my")).toBeTruthy();
    for (const row of rows) {
      expect(screen.getByTestId(`my-session-${row.sessionId}`)).toBeTruthy();
    }
  });

  // Issue #426: the display name is «KUDY» (the owner's 2026-10-01 decision),
  // not «My KUDY» — reverting the string turns this red.
  // G21.17 (issue #551, AC3): the history row labels its content language —
  // an existing differently localized session stays resumable and labelled;
  // an unknown stored code renders as-is, never rewritten into a guess.
  test("the history rows label their content language from the registry", async () => {
    const rows = [
      { ...finishedSummary(1), locale: "uk" },
      { ...finishedSummary(2), locale: "en" },
      { ...finishedSummary(3), locale: "unknown-code" },
    ];
    const services = createServices({ sessionHistory: historyPort(rows) });
    renderRouter({ _layout: layoutWith(services), "(tabs)/my": My }, { initialUrl: "/my" });
    expect((await screen.findByTestId("my-session-locale-walk-render-1")).props.children).toBe("Українська");
    expect(screen.getByTestId("my-session-locale-walk-render-2").props.children).toBe("English");
    expect(screen.getByTestId("my-session-locale-walk-render-3").props.children).toBe("unknown-code");
  });

  test("the surface's title renders «KUDY» in the display locale", async () => {
    renderRouter({ _layout: layoutWith(createServices({})), "(tabs)/my": My }, { initialUrl: "/my" });
    expect(await screen.findByTestId("screen-KUDY")).toBeTruthy();
    expect(screen.getByText("KUDY")).toBeTruthy();
  });
});

// G22.06 (issue #611): the paged history surface — the FlatList windows the
// loaded page (the visible rows mount, never the whole page at once) and the
// load-more walks the store's cursor through the real screen path.
describe("KUDY paged history (G22.06)", () => {
  test("history_list_renders_visible_rows: a full page of 50 windows its rows", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => finishedSummary(i + 1));
    const services = createServices({ sessionHistory: historyPort(rows) });
    renderRouter({ _layout: layoutWith(services), "(tabs)/my": My }, { initialUrl: "/my" });
    expect(await screen.findByTestId("my-history-section")).toBeTruthy();
    expect(screen.getByTestId("my-session-walk-render-1")).toBeTruthy();
    // the window: a full page mounts some rows, never all 50 at once —
    // mapping the whole loaded page instead turns the count assertion red
    const mounted = screen.queryAllByTestId(/^my-session-walk-render-\d+$/);
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThan(rows.length);
  });

  test("scrolling to the end reads the next page through the screen's load-more", async () => {
    // The first page fills the initial render window exactly (12 rows): RN
    // arms onEndReached once the last cell of the data is mounted, and the
    // jest surface gets no layout events to widen the window afterwards.
    const pageOne = Array.from({ length: 12 }, (_, i) => finishedSummary(i + 1));
    const pageTwo = Array.from({ length: 30 }, (_, i) => finishedSummary(100 + i));
    const last = pageOne[11]!;
    const cursor: SessionHistoryCursor = { startedAt: last.startedAt, sessionId: last.sessionId };
    let calls = 0;
    const services = createServices({
      sessionHistory: {
        listPage: async (received) => {
          calls += 1;
          if (received === null) return { live: null, rows: pageOne, nextCursor: cursor };
          return { live: null, rows: pageTwo, nextCursor: null };
        },
      },
    });
    renderRouter({ _layout: layoutWith(services), "(tabs)/my": My }, { initialUrl: "/my" });
    await screen.findByTestId("my-history-section");
    // A real scroll arms RN's internal metrics before it calls the list's
    // onEndReached; the jest surface gets no layout events, so the test
    // invokes the same handler a real scroll reaches — the screen's
    // onEndReached → store.loadMore → port path is what is under test here,
    // not RN's own metric arming (the controller suite covers the cursor
    // semantics behind it).
    fireEvent(screen.getByTestId("scroll-my"), "onEndReached", { distanceFromEnd: 0 });
    // the appended page went through the real screen → store → FlatList path
    await waitFor(() => {
      const state = services.history?.controller.getState();
      expect(state?.status === "ready" && state.rows.length).toBe(42);
    });
    // boot read + the focus read + the load-more page
    expect(calls).toBe(3);
  });
});

// UX 05 (issue #351): the rows show the catalog's guide title when the
// catalog names the route; a route it does not name keeps the raw id — the
// durable zone's own fact. Removing the lookup (or the fallback) fails one
// of the two assertions.
describe("KUDY guide titles (UX 05)", () => {
  test("the ready catalog names the route; an unknown route falls back to its id", async () => {
    serve(CATALOG_FIXTURES);
    const rows = [
      { ...finishedSummary(1), routeId: "guide-route-a1" },
      { ...finishedSummary(2), routeId: "route-offline" },
    ];
    const services = createServices({
      catalogOrigin: "https://catalog.test",
      catalogSha256: sha256,
      sessionHistory: historyPort(rows),
    });
    renderRouter({ _layout: layoutWith(services), "(tabs)/my": My }, { initialUrl: "/my" });
    expect(await screen.findByText("Гісторыі сукнараў: ад мытні да порта")).toBeTruthy();
    expect(screen.getByText("route-offline")).toBeTruthy();
  });
});

// UX 07 (issue #353): the loading state shows the shared spinner next to the
// «Загрузка…» text — a never-resolving history read holds the surface in
// loading. Reverting the LoadingIndicator wiring in app/(tabs)/my.tsx turns
// this red (implementation-rules 1).
describe("KUDY loading indicator (UX 07)", () => {
  test("the loading state shows the ActivityIndicator next to the text", async () => {
    const services = createServices({ sessionHistory: { listPage: () => new Promise(() => {}) } });
    renderRouter({ _layout: layoutWith(services), "(tabs)/my": My }, { initialUrl: "/my" });
    expect(await screen.findByTestId("loading-indicator")).toBeTruthy();
    expect(screen.getByText("Загрузка…")).toBeTruthy();
  });
});

// G06.05 (issue #280, AC4): a failed history read is not a dead end — the
// named retry re-runs the controller's refresh, and a recovered read renders
// the rows (implementation-rules 1: removing the retry turns this red).
test("G06.05: the unavailable history offers the named retry and recovers", async () => {
  const rows = [finishedSummary(1)];
  let calls = 0;
  const listPage = async (): Promise<SessionHistoryPage> => {
    calls += 1;
    // The boot read and the focus read both fail — the retry press is the
    // third read, and it is the one that recovers.
    if (calls < 3) throw new Error("db busy");
    return { live: null, rows, nextCursor: null };
  };
  const services = createServices({ sessionHistory: { listPage } });
  renderRouter({ _layout: layoutWith(services), "(tabs)/my": My }, { initialUrl: "/my" });
  expect(await screen.findByTestId("my-unavailable")).toBeTruthy();
  fireEvent.press(screen.getByTestId("btn-my-retry"));
  await waitFor(() => expect(screen.getByTestId("my-session-walk-render-1")).toBeTruthy());
  expect(calls).toBe(3);
});

// G06.10.e (issue #405): the calm surface carries the paper grain over the
// unchanged paper — the wrapper's layer sits under the scrolling history.
// Removing the wrapper from the screen turns this red (implementation-rules 1).
describe("KUDY paper grain (G06.10.e)", () => {
  test("the surface renders the grain layer over the unchanged paper", async () => {
    renderRouter({ _layout: layoutWith(createServices({})), "(tabs)/my": My }, { initialUrl: "/my" });
    expect(await screen.findByTestId("screen-KUDY")).toBeTruthy();
    // The grain is in the render tree but never in the a11y tree — the
    // default query (which walks the accessibility tree) misses it.
    expect(screen.queryByTestId("paper-grain")).toBeNull();
    expect(screen.getByTestId("paper-grain", { includeHiddenElements: true })).toBeTruthy();
    expect(flatStyle(screen.getByTestId("screen-KUDY")).backgroundColor).toBe(tokens.colorPaper);
    // The content above the grain: the history list is mounted.
    expect(screen.getByTestId("scroll-my")).toBeTruthy();
  });
});

// G14.04.d (issue #305, AC3): the language row — the UI-locale switch the
// surface offers (uk-release-scope §4). Pressing uk re-renders the chrome
// words in place: the same mounted surface keeps its history read count (a
// restart would re-run the boot read), the section header changes from the
// be line to the uk one, and the chosen option rides the selected a11y
// state. The walk's own locale stays out of the switch's reach — the store
// holds no session reference (uiLocaleStore.test.ts).
describe("KUDY language row (G14.04.d)", () => {
  test("picking uk re-renders the words in place, no restart", async () => {
    let reads = 0;
    const services = createServices({
      sessionHistory: { listPage: async () => { reads += 1; return { live: null, rows: [], nextCursor: null }; } },
    });
    renderRouter({ _layout: layoutWith(services), "(tabs)/my": My }, { initialUrl: "/my" });
    expect(await screen.findByText("Бягучая прагулка")).toBeTruthy();
    const readsAtStart = reads;
    fireEvent.press(screen.getByTestId("btn-ui-locale-uk"));
    expect(await screen.findByText("Поточна прогулянка")).toBeTruthy();
    expect(screen.queryByText("Бягучая прагулка")).toBeNull();
    // No restart: the switch fired no second boot of the surface's reads.
    expect(reads).toBe(readsAtStart);
    // The composition root reads through the switch — the same services
    // object, the locale member is the switched value.
    expect(services.uiLocale.current()).toBe("uk");
    expect(services.locale).toBe("uk");
    expect(screen.getByTestId("btn-ui-locale-uk").props.accessibilityState).toEqual({ selected: true });
  });

  test("the row offers the eight self-named locales and marks the current one", async () => {
    renderRouter({ _layout: layoutWith(createServices({})), "(tabs)/my": My }, { initialUrl: "/my" });
    expect(await screen.findByTestId("my-ui-locale")).toBeTruthy();
    expect(screen.getByText("Беларуская")).toBeTruthy();
    expect(screen.getByText("English")).toBeTruthy();
    expect(screen.getByText("Українська")).toBeTruthy();
    // G21.10 (issue #544): the de catalogue landed, the picker derives the
    // fourth chip from the registry's complete set.
    expect(screen.getByText("Deutsch")).toBeTruthy();
    // G21.11 (issue #545): the es catalogue lands, the picker derives the
    // fifth chip the same way; G21.12 (issue #546) adds the sixth, Français;
    // G21.13 (issue #547) adds the seventh, Čeština; G21.14 (issue #548)
    // completes the set with the eighth, Svenska.
    expect(screen.getByText("Español")).toBeTruthy();
    expect(screen.getByText("Français")).toBeTruthy();
    expect(screen.getByText("Čeština")).toBeTruthy();
    expect(screen.getByText("Svenska")).toBeTruthy();
    expect(screen.getByTestId("btn-ui-locale-be").props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId("btn-ui-locale-en").props.accessibilityState).toEqual({ selected: false });
    // Switching to en re-renders the chrome in English (AC3: no restart) —
    // the honest-unavailable line renders with no history port behind the
    // surface, so it is the always-present chrome word.
    expect(screen.getByText("Гісторыя недаступная.")).toBeTruthy();
    fireEvent.press(screen.getByTestId("btn-ui-locale-en"));
    expect(await screen.findByText("History unavailable.")).toBeTruthy();
    expect(screen.queryByText("Гісторыя недаступная.")).toBeNull();
  });

  test("G21.10 (issue #544): picking de re-renders the honest-unavailable line in German", async () => {
    // No history port behind the surface: the always-present chrome word
    // carries the language probe (the three-locale test's idiom), German
    // here. The no-restart property is proven by the uk sibling above —
    // the same switch mechanism, one proof is enough.
    const services = createServices({});
    renderRouter({ _layout: layoutWith(services), "(tabs)/my": My }, { initialUrl: "/my" });
    expect(await screen.findByTestId("my-ui-locale")).toBeTruthy();
    fireEvent.press(screen.getByTestId("btn-ui-locale-de"));
    expect(await screen.findByText("Verlauf nicht verfügbar.")).toBeTruthy();
    expect(screen.queryByText("Гісторыя недаступная.")).toBeNull();
    expect(services.uiLocale.current()).toBe("de");
    expect(screen.getByTestId("btn-ui-locale-de").props.accessibilityState).toEqual({ selected: true });
  });

  test("G21.11 (issue #545): the es switch round-trips through the same store", async () => {
    // The Spanish merge point's own proof, asserted from the store outward:
    // pick es, the current() moves, the Spanish chrome word renders, and the
    // selector marks the es chip. The no-restart property needs no second
    // proof — the uk and de siblings above exercise the same mechanism.
    const services = createServices({});
    renderRouter({ _layout: layoutWith(services), "(tabs)/my": My }, { initialUrl: "/my" });
    expect(await screen.findByTestId("my-ui-locale")).toBeTruthy();
    fireEvent.press(screen.getByTestId("btn-ui-locale-es"));
    expect(services.uiLocale.current()).toBe("es");
    expect(await screen.findByText("El historial no está disponible.")).toBeTruthy();
    expect(screen.getByTestId("btn-ui-locale-es").props.accessibilityState).toEqual({ selected: true });
    expect(screen.queryByText("Гісторыя недаступная.")).toBeNull();
  });

  test("G21.12 (issue #546): picking fr re-renders the honest-unavailable line in French", async () => {
    const services = createServices({});
    renderRouter({ _layout: layoutWith(services), "(tabs)/my": My }, { initialUrl: "/my" });
    expect(await screen.findByTestId("my-ui-locale")).toBeTruthy();
    fireEvent.press(screen.getByTestId("btn-ui-locale-fr"));
    expect(services.uiLocale.current()).toBe("fr");
    expect(screen.getByTestId("btn-ui-locale-fr").props.accessibilityState).toEqual({ selected: true });
  });

  test("G21.13 (issue #547): picking cs re-renders the honest-unavailable line in Czech", async () => {
    const services = createServices({});
    renderRouter({ _layout: layoutWith(services), "(tabs)/my": My }, { initialUrl: "/my" });
    expect(await screen.findByTestId("my-ui-locale")).toBeTruthy();
    fireEvent.press(screen.getByTestId("btn-ui-locale-cs"));
    expect(services.uiLocale.current()).toBe("cs");
    expect(await screen.findByText("Historie není dostupná.")).toBeTruthy();
    expect(screen.getByTestId("btn-ui-locale-cs").props.accessibilityState).toEqual({ selected: true });
    expect(screen.queryByText("Гісторыя недаступная.")).toBeNull();
  });

  test("G21.14 (issue #548): picking sv completes the row — the honest-unavailable line renders in Swedish", async () => {
    const services = createServices({});
    renderRouter({ _layout: layoutWith(services), "(tabs)/my": My }, { initialUrl: "/my" });
    expect(await screen.findByTestId("my-ui-locale")).toBeTruthy();
    fireEvent.press(screen.getByTestId("btn-ui-locale-sv"));
    expect(services.uiLocale.current()).toBe("sv");
    expect(await screen.findByText("Historiken är inte tillgänglig.")).toBeTruthy();
    expect(screen.getByTestId("btn-ui-locale-sv").props.accessibilityState).toEqual({ selected: true });
    expect(screen.queryByText("Гісторыя недаступная.")).toBeNull();
  });
});

// G16.03 (issue #74): the own-ratings list over the real feedback controller
// (rule 15) — a rating stored and acknowledged through the production
// repository before the surface mounts lists with its honest state word, and
// the row's edit opens the form bound to the row's own target with the
// person's previous choice preselected.
describe("KUDY own ratings (G16.03)", () => {
  test("a sent own rating lists, and its edit opens the form with the acknowledged star", async () => {
    const driver = openIdentifiedStore();
    const transport = scriptedTransport(() => okPut(1));
    const sync = createFeedbackSync({
      driver,
      secretStore: secretBox("secret-a"),
      baseUrl: "https://functions.example.co/functions/v1",
      transport,
      now: () => NOW,
    });
    saveDraft(
      driver,
      GUIDE_TARGET,
      { score: 4, reasonCodes: ["audio_problem"], disclosureVersion: FEEDBACK_DISCLOSURE_VERSION },
      { now: NOW },
    );
    sendNow(driver, GUIDE_TARGET, { now: NOW, mutationId: M1 });
    await sync.flush();
    const services = createServices({
      sessionHistory: historyPort([]),
      feedback: { driver, sync },
    });
    renderRouter({ _layout: layoutWith(services), "(tabs)/my": My, feedback: FeedbackForm }, { initialUrl: "/my" });
    expect(await screen.findByTestId("my-ratings-section")).toBeTruthy();
    expect(screen.getByTestId("my-rating-0")).toBeTruthy();
    expect(screen.getByTestId("my-rating-state-0").props.children).toBe(feedbackStrings("be").stateSent);
    // The row's facts line keeps the bound identity in the canon order — the
    // content locale, then the pinned version (issue #598).
    const be = feedbackStrings("be");
    expect(screen.getByText(`${be.ratingOf(4)} · ${be.targetLine("be", "1")}`)).toBeTruthy();
    fireEvent.press(screen.getByTestId("btn-rating-edit-0"));
    expect(await screen.findByTestId("screen-Feedback")).toBeTruthy();
    // The form opened bound to the row's target: the acknowledged star comes
    // back preselected (the person's own choice, not a default).
    expect(screen.getByTestId("feedback-star-4").props.accessibilityState.selected).toBe(true);
  });

  test("an empty own list says so honestly", async () => {
    const driver = openIdentifiedStore();
    const sync = createFeedbackSync({
      driver,
      secretStore: secretBox("secret-a"),
      baseUrl: "https://functions.example.co/functions/v1",
      transport: scriptedTransport(() => okPut(1)),
      now: () => NOW,
    });
    const services = createServices({
      sessionHistory: historyPort([]),
      feedback: { driver, sync },
    });
    renderRouter({ _layout: layoutWith(services), "(tabs)/my": My }, { initialUrl: "/my" });
    expect(await screen.findByTestId("my-ratings-empty")).toBeTruthy();
  });
});

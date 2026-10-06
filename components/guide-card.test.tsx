// G06.01.a (issue #313) — the responsive boundary of the scheme
// (screens-and-transitions.md, Explore row): one column below 821 px, two
// columns at 821 px and above. Colocated with the module it tests in
// components/ (issue #339 — moved out of app/ with guide-card.tsx).
import { describe, expect, test } from "@jest/globals";

import { isWide } from "./guide-card";

describe("responsive split (one column < 821 px, two ≥ 821 px)", () => {
  test("820 px stays one column, 821 px is the two-column edge", () => {
    expect(isWide(820)).toBe(false);
    expect(isWide(821)).toBe(true);
  });
});

// G21.17 (issue #551) — the surfaces' text-locale selection rule: the pure
// filter over the card facts (all eight UI locales) and the two honest empty
// states of the city catalog view (the language explanation vs NAV3's «не
// апублікавана»; neither is a service failure).
import { render, screen } from "@testing-library/react-native";

import type { CatalogGuideCard } from "../controllers/catalog/catalogController";
import { CatalogStateView, visibleGuides } from "./guide-card";
import { uiStrings } from "./ui-strings";

const card = (routeId: string, textLocales: readonly string[]): CatalogGuideCard => ({
  routeId,
  version: "1",
  offerId: `offer-${routeId}`,
  title: routeId,
  summary: null,
  textLocales,
  audioLocales: [],
  localesKnown: true,
  access: "free",
  editorialOrder: 1,
  estimatedDuration: null,
});

const ready = (guides: readonly CatalogGuideCard[]) => ({ kind: "ready" as const, guides, degraded: null });

describe("selected_text_locale_filter", () => {
  test("the be/en-only list is visible to be and en, hidden to the six other UI locales", () => {
    const guides = [card("g1", ["be", "en"])];
    for (const locale of ["be", "en", "uk", "de", "es", "fr", "cs", "sv"] as const) {
      const visible = visibleGuides(guides, locale);
      expect(visible).toHaveLength(locale === "be" || locale === "en" ? 1 : 0);
    }
  });

  test("an offer shows only in the locales its published text covers", () => {
    const guides = [card("fr-only", ["fr"]), card("multi", ["be", "en", "uk", "de", "es", "fr", "cs", "sv"])];
    expect(visibleGuides(guides, "fr").map((c) => c.routeId)).toEqual(["fr-only", "multi"]);
    expect(visibleGuides(guides, "be").map((c) => c.routeId)).toEqual(["multi"]);
  });
});

describe("empty_locale_catalogue", () => {
  // The be-fallback probe rotated de→fr→es→cs→sv as G21.10 #544, G21.12
  // #546, G21.11 #545 and G21.13 #547 landed their catalogues — each landing
  // retires its code. G21.14 (issue #548) lands sv, the last planned code:
  // all eight requested languages are complete, so the probe rides an
  // unregistered code (pl) and sv asserts its own words beside it.
  test("guides exist in other languages — the filtered-empty state explains the language", () => {
    render(<CatalogStateView state={ready([card("g1", ["be", "en"])])} variant="rubric" locale="pl" />);
    expect(screen.getByTestId("city-message").props.children).toBe(uiStrings("be").textLocaleEmpty);
  });

  test("nothing is published at all — NAV3's honest empty stays", () => {
    render(<CatalogStateView state={ready([])} variant="rubric" locale="pl" />);
    expect(screen.getByTestId("city-message").props.children).toBe(uiStrings("be").notPublished);
  });

  test("G21.14 (issue #548): sv renders its own filtered-empty and not-published words", () => {
    render(<CatalogStateView state={ready([card("g1", ["be", "en"])])} variant="rubric" locale="sv" />);
    expect(screen.getByTestId("city-message").props.children).toBe("Det finns ännu inga guider med text på det här språket.");
    render(<CatalogStateView state={ready([])} variant="rubric" locale="sv" />);
    expect(screen.getByTestId("city-message").props.children).toBe("ej publicerad");
  });
});

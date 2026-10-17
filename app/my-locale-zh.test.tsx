// G21.46 (issue #670) — the real Chinese catalogue at the native surface. zh
// is the registry's first real gated code: complete (the catalogue ships with
// this task) and closed (the release flag keeps it off the picker until
// G21.50 turns it on). Production OPEN_UI_LOCALES therefore omits it, so this
// file opens it through the documented module seam (the my-locale-gate idiom)
// and renders the REAL zh words, not a synthetic stand-in: the chip carries
// the registry native name and picking it re-renders the honest-unavailable
// line through the production strings getter. The Chinese words below are
// written as \uXXXX escapes so the committed bytes stay CJK-free (criterion
// 7) — they decode to the real glyphs at run time. Reverting the zh
// catalogue, the
// store's open-set read or the picker's open-set vocabulary turns this red.
import { describe, expect, jest, test } from "@jest/globals";
import { fireEvent, renderRouter, screen } from "expo-router/testing-library";

import My from "./(tabs)/my";
import { createServices } from "../controllers/createServices";
import { uiStrings } from "../components/ui-strings";
import { OPEN_UI_LOCALES, uiLocaleNativeName } from "../contracts/ui-locales";
import { layoutWith } from "../test/render-helpers";

// The flag opens every complete code — including zh, the real gated one.
jest.mock("../contracts/ui-locales", () => {
  const actual = jest.requireActual("../contracts/ui-locales") as typeof import("../contracts/ui-locales");
  return { ...actual, OPEN_UI_LOCALES: [...actual.COMPLETE_UI_LOCALES] };
});

const opened = OPEN_UI_LOCALES as unknown as string[];

describe("G21.46 (issue #670): the Chinese catalogue renders at the picker", () => {
  test("the native name of the opened code is the registry self-name, not a translation", () => {
    expect(opened).toContain("zh");
    expect(uiLocaleNativeName("zh")).toBe("\u7B80\u4F53\u4E2D\u6587");
  });

  test("picking the opened zh chip re-renders the honest-unavailable line in Chinese", async () => {
    const services = createServices({});
    renderRouter({ _layout: layoutWith(services), "(tabs)/my": My }, { initialUrl: "/my" });
    expect(await screen.findByTestId("my-ui-locale")).toBeTruthy();
    const chip = screen.getByTestId("btn-ui-locale-zh");
    expect(screen.getByText("\u7B80\u4F53\u4E2D\u6587")).toBeTruthy();
    fireEvent.press(chip);
    expect(services.uiLocale.current()).toBe("zh");
    expect(await screen.findByText(uiStrings("zh").historyUnavailable)).toBeTruthy();
    expect(uiStrings("zh").historyUnavailable).toBe("\u5386\u53F2\u8BB0\u5F55\u4E0D\u53EF\u7528\u3002");
    expect(screen.getByTestId("btn-ui-locale-zh").props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.queryByText(uiStrings("be").historyUnavailable)).toBeNull();
  });
});

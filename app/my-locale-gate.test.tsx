// G21.50 (issue #711) — the picker gate at the surface. The real registry
// has no gated code yet (zh lands with #669/#670), so this suite replaces
// two exports of the registry module around its real implementation: a
// synthetic ninth code `zz` is registered-complete in both scenarios and
// closed in the first, flag-opened in the second. The factory hands out
// mutable arrays and the tests mutate them IN PLACE — jest snapshots the
// factory result once, so reassignment never reaches the consumers. A picker
// reading COMPLETE_UI_LOCALES again (the revert) renders the closed code in
// the first scenario and turns this file red.
import { describe, expect, jest, test } from "@jest/globals";
import { fireEvent, renderRouter, screen } from "expo-router/testing-library";

import My from "./(tabs)/my";
import { createServices } from "../controllers/createServices";
import { layoutWith } from "../test/render-helpers";
import * as contracts from "../contracts/ui-locales";

jest.mock("../contracts/ui-locales", () => {
  const actual = jest.requireActual("../contracts/ui-locales") as typeof import("../contracts/ui-locales");
  return {
    ...actual,
    OPEN_UI_LOCALES: [...actual.COMPLETE_UI_LOCALES],
    COMPLETE_UI_LOCALES: [...actual.COMPLETE_UI_LOCALES, "zz"],
    uiLocaleNativeName: (code: string) =>
      code === "zz" ? "Testnine" : actual.uiLocaleNativeName(code as Parameters<typeof actual.uiLocaleNativeName>[0]),
  };
});

const mockOpen = contracts.OPEN_UI_LOCALES as unknown as string[];
const mockComplete = contracts.COMPLETE_UI_LOCALES as unknown as string[];

const setGate = (open: string[], complete: string[]) => {
  mockOpen.length = 0;
  mockOpen.push(...open);
  mockComplete.length = 0;
  mockComplete.push(...complete);
};

const EIGHT = ["be", "en", "uk", "de", "es", "fr", "cs", "sv"];

describe("G21.50 (issue #711): the picker advertises the open subset", () => {
  test("a registered-but-closed code is omitted from the picker; the eight stay present", async () => {
    setGate(EIGHT, [...EIGHT, "zz"]);
    const services = createServices({});
    renderRouter({ _layout: layoutWith(services), "(tabs)/my": My }, { initialUrl: "/my" });
    expect(await screen.findByTestId("my-ui-locale")).toBeTruthy();
    expect(screen.queryByTestId("btn-ui-locale-zz")).toBeNull();
    for (const code of EIGHT) {
      expect(screen.getByTestId(`btn-ui-locale-${code}`)).toBeTruthy();
    }
  });

  test("the flag opening the code puts it on the picker and makes it switchable", async () => {
    setGate([...EIGHT, "zz"], [...EIGHT, "zz"]);
    const services = createServices({});
    renderRouter({ _layout: layoutWith(services), "(tabs)/my": My }, { initialUrl: "/my" });
    expect(await screen.findByTestId("btn-ui-locale-zz")).toBeTruthy();
    fireEvent.press(screen.getByTestId("btn-ui-locale-zz"));
    expect(services.uiLocale.current()).toBe("zz");
  });
});

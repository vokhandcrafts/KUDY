// G21.47 (issue #671) — the probe surface's own guard, not a device claim:
// it pins the dev-only route to the rows the device run reads (removing a
// row or the surface turns this file red), pins the decoded fixture content
// (escape sequences must stay decodable — the machine files carry no raw CJK
// bytes), pins the scroll-inset frame (UX 02 idiom, observed clipping in the
// first device pass), and pins the release guard (outside __DEV__ the
// surface renders nothing). The on-device facts themselves live in the
// evidence run — this suite does not claim them.
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { render, screen, within } from "@testing-library/react-native";

jest.mock("react-native-safe-area-context", () => ({
  ...(jest.requireActual("react-native-safe-area-context") as Record<string, unknown>),
  useSafeAreaInsets: () => ({ top: 50, bottom: 34, left: 0, right: 0 }),
}));

import HanProbe from "./han-probe";

const g = globalThis as { __DEV__?: boolean };

const CARD_HANS = "\u5e03\u62c9\u683c\u57ce\u5821\u5386\u53f2\u5efa\u7b51\u7fa4\u4e0e\u9ec4\u91d1\u5df7\u5bfc\u89c8";
const S2_SHARED = "\u9AA8\u76F4\u4EE4\u8FC7\u8FB9\u8BF7\u51C0\u6E29\u6D77\u8349";

describe("G21.47 (issue #671): the dev-only Han probe surface", () => {
  afterEach(() => {
    g.__DEV__ = true;
  });

  test("under __DEV__ it renders the rows the device run reads", () => {
    render(<HanProbe />);
    for (const id of [
      "han-probe/title",
      "han-probe/card-hans",
      "han-probe/card-hans-strong",
      "han-probe/card-hant",
      "han-probe/card-long",
      "han-probe/s2-shared",
      "han-probe/action-primary",
      "han-probe/action-disabled",
      "han-probe/error",
      "han-probe/narrative",
      "han-probe/timer",
      "han-probe/scale-scaled-cap",
      "han-probe/scale-raw-full",
      "han-probe/scale-pinned-off",
    ]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
  });

  test("the escape-encoded fixtures decode to the G21.40 fixture values", () => {
    render(<HanProbe />);
    expect(within(screen.getByTestId("han-probe/card-hans")).getByText(CARD_HANS)).toBeTruthy();
    expect(within(screen.getByTestId("han-probe/s2-shared")).getByText(S2_SHARED)).toBeTruthy();
  });

  test("the scroll content carries the pinned insets: top 50+16, bottom 34+16 (UX 02)", () => {
    render(<HanProbe />);
    // The insets ride contentContainerStyle (the scrollable content), not
    // the frame style — a frame padding never joins the scroll extent, so
    // the last rows stay unreachable behind the gesture bar.
    const container = screen.getByTestId("screen-Han probe").props.contentContainerStyle;
    expect(container.paddingTop).toBe(66);
    expect(container.paddingBottom).toBe(50);
  });

  test("outside __DEV__ the surface renders nothing", () => {
    g.__DEV__ = false;
    render(<HanProbe />);
    expect(screen.queryByTestId("han-probe/title")).toBeNull();
  });
});

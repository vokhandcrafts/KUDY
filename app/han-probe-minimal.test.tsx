// Issue #718 (G21.47 follow-up) — the minimal reproduction surface's own
// guard, not a device claim: it pins the dev-only route to the rows the
// #718 device runs read (removing a row or the surface turns this file red),
// pins the decoded fixture content (escape sequences must stay decodable —
// no raw CJK bytes in the source), and pins the release guard (outside
// __DEV__ the surface renders nothing). The on-device facts live in
// docs/testing/evidence/2026-10-11-g718/ — this suite does not claim them.
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { render, screen, within } from "@testing-library/react-native";

import HanProbeMinimal from "./han-probe-minimal";

const CARD_HANS = "\u5e03\u62c9\u683c\u57ce\u5821\u5386\u53f2\u5efa\u7b51\u7fa4\u4e0e\u9ec4\u91d1\u5df7\u5bfc\u89c8";
const g = globalThis as { __DEV__?: boolean };

// The pinned fake insets of the G21.47 test idiom (top 50, bottom 34).
jest.mock("react-native-safe-area-context", () => ({
  ...(jest.requireActual("react-native-safe-area-context") as Record<string, unknown>),
  useSafeAreaInsets: () => ({ top: 50, bottom: 34, left: 0, right: 0 }),
}));

describe("issue #718: the dev-only minimal reproduction surface", () => {
  afterEach(() => {
    g.__DEV__ = true;
  });

  test("under __DEV__ it renders the rows the device run reads", () => {
    render(<HanProbeMinimal />);
    for (const id of [
      "han-minimal/raw-ui",
      "han-minimal/raw-default-font",
      "han-minimal/size-control",
    ]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
  });

  test("the escape-encoded fixture decodes to the G21.40 fixture value", () => {
    render(<HanProbeMinimal />);
    expect(within(screen.getByTestId("han-minimal/raw-ui")).getByText(CARD_HANS)).toBeTruthy();
    expect(within(screen.getByTestId("han-minimal/raw-default-font")).getByText(CARD_HANS)).toBeTruthy();
    expect(within(screen.getByTestId("han-minimal/size-control")).getByText(CARD_HANS)).toBeTruthy();
  });

  test("outside __DEV__ the surface renders nothing", () => {
    g.__DEV__ = false;
    render(<HanProbeMinimal />);
    expect(screen.queryByTestId("han-minimal/raw-ui")).toBeNull();
  });
});

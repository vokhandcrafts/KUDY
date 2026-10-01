// UX 02 (issue #348) — the shared back element's own contract: the label is
// hosted by a <Text> (within().getByText() reaches only <Text> hosts — a
// reverted bare string in Pressable fails here, the #344 guard mechanism),
// the touch target is ≥44×44dp (AC2) and a screen-provided onPress wins over
// the default router.back. G06.10 (issue #432): the one back image is the
// Lucide arrow rendered through the icon layer beside the word — a dropped
// glyph or a recolored one turns the arrow guard red. The navigation
// behaviour itself is covered by the screen suites (app/back-navigation.test.tsx).
import { describe, expect, jest, test } from "@jest/globals";
import { fireEvent, renderRouter, screen, within } from "expo-router/testing-library";
import { Svg } from "react-native-svg";

import { BackButton } from "./back-button";
import { tokens } from "./design-tokens";

test("the back label is hosted by a <Text>, the Pressable carries the a11y wiring", () => {
  renderRouter({ index: () => <BackButton label="Назад" testID="btn-test-back" /> }, { initialUrl: "/" });
  const back = screen.getByTestId("btn-test-back");
  expect(within(back).getByText("Назад")).toBeTruthy();
  expect(back.props.accessibilityRole).toBe("button");
  expect(back.props.accessibilityLabel).toBe("Назад");
});

test("the one back image is the Lucide arrow beside the word (issue #432)", () => {
  renderRouter({ index: () => <BackButton label="Назад" testID="btn-test-back" /> }, { initialUrl: "/" });
  const back = screen.getByTestId("btn-test-back");
  // The glyph rides the deep per-glyph import (the class name pins the
  // arrow, a swapped glyph changes it) and the caption's own accent — the
  // arrow is part of the caption, not an ink-colored decoration.
  const svg = within(back).UNSAFE_getByType(Svg);
  expect(svg.props.className).toBe("lucide lucide-arrow-left");
  expect(svg.props.stroke).toBe(tokens.colorAccent);
  expect(within(back).getByText("Назад")).toBeTruthy();
});

test("the touch target is at least 44×44dp, hitSlop adds forgiveness", () => {
  renderRouter({ index: () => <BackButton label="Назад" testID="btn-test-back" /> }, { initialUrl: "/" });
  const back = screen.getByTestId("btn-test-back");
  expect(back.props.style.minHeight).toBeGreaterThanOrEqual(44);
  expect(back.props.style.minWidth).toBeGreaterThanOrEqual(44);
  expect(back.props.hitSlop).toEqual({ bottom: 8, left: 8, right: 8, top: 8 });
});

test("a screen-provided onPress wins over the default router.back", () => {
  const onPress = jest.fn();
  renderRouter(
    { index: () => <BackButton label="Назад" onPress={onPress} testID="btn-test-back" /> },
    { initialUrl: "/" },
  );
  fireEvent.press(screen.getByTestId("btn-test-back"));
  expect(onPress).toHaveBeenCalledTimes(1);
});

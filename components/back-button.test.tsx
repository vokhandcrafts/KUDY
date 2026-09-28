// UX 02 (issue #348) — the shared back element's own contract: the label is
// hosted by a <Text> (within().getByText() reaches only <Text> hosts — a
// reverted bare string in Pressable fails here, the #344 guard mechanism),
// the touch target is ≥44×44dp (AC2) and a screen-provided onPress wins over
// the default router.back. The navigation behaviour itself is covered by the
// screen suites (app/back-navigation.test.tsx).
import { describe, expect, jest, test } from "@jest/globals";
import { fireEvent, renderRouter, screen, within } from "expo-router/testing-library";

import { BackButton } from "./back-button";

test("the back label is hosted by a <Text>, the Pressable carries the a11y wiring", () => {
  renderRouter({ index: () => <BackButton label="← Назад" testID="btn-test-back" /> }, { initialUrl: "/" });
  const back = screen.getByTestId("btn-test-back");
  expect(within(back).getByText("← Назад")).toBeTruthy();
  expect(back.props.accessibilityRole).toBe("button");
  expect(back.props.accessibilityLabel).toBe("← Назад");
});

test("the touch target is at least 44×44dp, hitSlop adds forgiveness", () => {
  renderRouter({ index: () => <BackButton label="← Назад" testID="btn-test-back" /> }, { initialUrl: "/" });
  const back = screen.getByTestId("btn-test-back");
  expect(back.props.style.minHeight).toBeGreaterThanOrEqual(44);
  expect(back.props.style.minWidth).toBeGreaterThanOrEqual(44);
  expect(back.props.hitSlop).toEqual({ bottom: 8, left: 8, right: 8, top: 8 });
});

test("a screen-provided onPress wins over the default router.back", () => {
  const onPress = jest.fn();
  renderRouter(
    { index: () => <BackButton label="← Назад" onPress={onPress} testID="btn-test-back" /> },
    { initialUrl: "/" },
  );
  fireEvent.press(screen.getByTestId("btn-test-back"));
  expect(onPress).toHaveBeenCalledTimes(1);
});

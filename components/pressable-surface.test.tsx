// UX 03 (issue #349) — the guard over the one shared pressed wrapper
// (criterion 4): the accessibilityRole must reach the pressable element and
// the pressed dim must appear while pressed and leave on release — removing
// either turns the suite red. The Android ripple is wiring the render tree
// cannot show on the test platform, so its guard pins the wrapper source
// (the test/design-tokens.test.mjs source-pin idiom).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { PressableSurface } from "./pressable-surface";

describe("PressableSurface (UX 03, issue #349)", () => {
  test("accessibilityRole reaches the pressable element", () => {
    render(
      <PressableSurface accessibilityRole="button" testID="surface">
        <Text>Націсні</Text>
      </PressableSurface>,
    );
    expect(screen.getByRole("button")).toBeTruthy();
  });

  test("the pressed state dims the surface by ≥10%", () => {
    // testOnly_pressed is Pressable's own test seam: it renders the surface
    // in its pressed state deterministically — the pressed branch of the
    // wrapper's style function runs on the production path (the responder
    // wiring itself is Pressability's, not the wrapper's).
    render(
      <PressableSurface testOnly_pressed testID="surface">
        <Text>Націсні</Text>
      </PressableSurface>,
    );
    const pressed = [screen.getByTestId("surface").props.style].flat(Infinity);
    expect(pressed.some((s) => s && typeof s === "object" && s.opacity === 0.9)).toBe(true);
  });

  test("the resting surface carries no pressed dim", () => {
    render(
      <PressableSurface testID="surface">
        <Text>Націсні</Text>
      </PressableSurface>,
    );
    const resting = [screen.getByTestId("surface").props.style].flat(Infinity);
    expect(resting.some((s) => s && typeof s === "object" && s.opacity === 0.9)).toBe(false);
  });

  test("the Android ripple stays wired in the wrapper source", () => {
    const source = readFileSync(join(process.cwd(), "components", "pressable-surface.tsx"), "utf8");
    expect(source).toMatch(/android_ripple/);
  });
});

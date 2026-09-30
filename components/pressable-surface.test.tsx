// UX 03 (issue #349) — the guard over the one shared pressed wrapper
// (criterion 4): the accessibilityRole must reach the pressable element and
// the pressed dim must appear while pressed and leave on release — removing
// either turns the suite red. The Android ripple is wiring the render tree
// cannot show on the test platform, so its guard pins the wrapper source
// (the test/design-tokens.test.mjs source-pin idiom).
// G06.10.d (issue #404) — the clay shelf guards: the shelf color is read
// from the canon shelf tokens through the token mirror, so the file-level
// mock overrides the mirror's accent shade with a synthetic value — a
// hardcoded canon literal in the wrapper fails every shelf assertion below
// (implementation-rules 1: the reverted-line check).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, jest, test } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { PressableSurface, type ShelfShade } from "./pressable-surface";
import { tokens } from "./design-tokens";

// The synthetic override differs from the canon #154f3a on purpose: the
// assertions below read the mock's value, so only a wrapper that actually
// consumes the mirror renders the overridden shade.
jest.mock("./design-tokens", () => {
  const actual = jest.requireActual("./design-tokens") as { tokens: Record<string, string> };
  return { tokens: { ...actual.tokens, colorShelfAccent: "#00aa55" } };
});

function renderShelf(shade: ShelfShade, pressed = false) {
  return render(
    <PressableSurface shelf={shade} testOnly_pressed={pressed} testID="surface">
      <Text>Націсні</Text>
    </PressableSurface>,
  );
}

function styleLayers() {
  return [screen.getByTestId("surface").props.style].flat(Infinity);
}

// The way React Native actually paints the stack: layers merged in order,
// the later one winning. The dip is a reduction over the shelf layer, so
// the merged object is what the eye (and the assertions) see.
type MergedStyle = {
  transform?: { translateY?: number }[];
  borderBottomWidth?: number;
  borderBottomColor?: string;
  opacity?: number;
};

function mergedStyle(): MergedStyle {
  return Object.assign(
    {},
    ...styleLayers().filter((s) => s && typeof s === "object"),
  ) as MergedStyle;
}

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

describe("PressableSurface clay shelf (G06.10.d, issue #404)", () => {
  test("the accent shelf renders the token mirror's shade — overriding the token changes the shelf", () => {
    renderShelf("accent");
    // tokens here is the mocked mirror: #00aa55, not the canon #154f3a. A
    // wrapper that hardcodes the canon literal fails this line.
    expect(mergedStyle().borderBottomColor).toBe(tokens.colorShelfAccent);
    expect(mergedStyle().borderBottomWidth).toBe(4);
  });

  test("the line shelf renders the line shade for the secondary actions", () => {
    renderShelf("line");
    expect(mergedStyle().borderBottomColor).toBe(tokens.colorShelfLine);
    expect(mergedStyle().borderBottomWidth).toBe(4);
  });

  test("pressing dips into the shelf — translate plus reduced shelf — while the dim still fires", () => {
    renderShelf("accent", true);
    const pressed = mergedStyle();
    expect(pressed.transform?.[0]?.translateY).toBe(2);
    expect(pressed.borderBottomWidth).toBe(2);
    expect(pressed.borderBottomColor).toBe(tokens.colorShelfAccent);
    expect(pressed.opacity).toBe(0.9);
  });

  test("the resting shelf carries no dip", () => {
    renderShelf("accent");
    const resting = mergedStyle();
    expect(resting.transform).toBeUndefined();
    expect(resting.borderBottomWidth).toBe(4);
  });

  test("a disabled pressable never dips — the disabled contract stays opacity-only", () => {
    render(
      <PressableSurface shelf="accent" disabled testOnly_pressed testID="surface">
        <Text>Націсні</Text>
      </PressableSurface>,
    );
    const forced = mergedStyle();
    expect(forced.transform).toBeUndefined();
    expect(forced.borderBottomWidth).toBe(4);
  });
});

// Accepted working splash (2026-10-28): the cold-start route presents the
// vector dragon before Explore. The same scene shows arriving paws, a blink
// combined with a quick side move, an animated mouth, then the KUDY word.
// The font is provisional and deliberately not pinned here.
import { afterEach, expect, jest, test } from "@jest/globals";
import { act } from "@testing-library/react-native";
import { renderRouter, screen } from "expo-router/testing-library";
import { Path } from "react-native-svg";
import { nextSplashSampleMs, SPLASH_DURATION_MS } from "../components/animated-splash";

import Explore from "./(tabs)/explore";
import Index from "./index";
import { createServices } from "../controllers/createServices";
import { flatStyle, layoutWith } from "../test/render-helpers";

function renderColdStart() {
  renderRouter(
    {
      _layout: layoutWith(createServices({})),
      index: Index,
      "(tabs)/explore": Explore,
    },
    { initialUrl: "/" },
  );
}

function advance(ms: number) {
  act(() => jest.advanceTimersByTime(ms));
}

function svgProp(id: string, name: "matrix" | "opacity" | "d") {
  return screen.getByTestId(id).props[name] as unknown;
}

function brandVisible() {
  const brand = screen.queryByTestId("splash-brand", { includeHiddenElements: true });
  if (!brand) return false;
  const style = flatStyle(brand);
  return style.display !== "none" && (typeof style.opacity !== "number" || style.opacity > 0);
}

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test("cold start shows a vector dragon with arriving paws, then opens Explore after the scene", () => {
  jest.useFakeTimers();
  renderColdStart();

  expect(screen.getByTestId("splash-scene")).toBeTruthy();
  expect(screen.queryByTestId("screen-Explore")).toBeNull();
  expect(screen.getByTestId("splash-head").findAllByType(Path).length).toBeGreaterThan(0);
  expect(screen.getByTestId("splash-paw-left").findAllByType(Path).length).toBeGreaterThan(0);
  expect(screen.getByTestId("splash-paw-right").findAllByType(Path).length).toBeGreaterThan(0);
  expect(brandVisible()).toBe(false);

  const firstLeftPaw = svgProp("splash-paw-left", "matrix");
  const firstRightPaw = svgProp("splash-paw-right", "matrix");
  advance(1_200);
  expect(svgProp("splash-paw-left", "matrix")).not.toEqual(firstLeftPaw);
  expect(svgProp("splash-paw-right", "matrix")).not.toEqual(firstRightPaw);
  expect(screen.queryByTestId("screen-Explore")).toBeNull();

  advance(5_900);
  expect(screen.getByTestId("screen-Explore")).toBeTruthy();
});

test("the side move happens during the blink; the mouth moves before KUDY appears", () => {
  jest.useFakeTimers();
  renderColdStart();

  advance(3_300);
  const headBefore = svgProp("splash-head", "matrix");
  const eyesBefore = svgProp("splash-eyes", "opacity");
  advance(350);
  expect(svgProp("splash-head", "matrix")).not.toEqual(headBefore);
  expect(svgProp("splash-eyes", "opacity")).not.toEqual(eyesBefore);
  expect(brandVisible()).toBe(false);

  advance(250);
  const mouthBefore = svgProp("splash-mouth", "d");
  advance(550);
  expect(svgProp("splash-mouth", "d")).not.toEqual(mouthBefore);
  advance(750);
  expect(brandVisible()).toBe(false);
  advance(900);
  expect(screen.getByText("KUDY")).toBeTruthy();
  expect(brandVisible()).toBe(true);
  expect(screen.queryByTestId("screen-Explore")).toBeNull();
});

// On the emulator the word read "KUD": the brand Text mounted with the
// system fallback while GolosText was still loading, and when the face
// arrived Android re-wrapped the wider word inside the stale one-line box —
// the Y fell onto a second line the view clipped. The full-width centered
// line cannot re-wrap; reverting the brand style to content sizing must
// fail here.
test("the KUDY word is a full-width centered line, not a content-sized box", () => {
  jest.useFakeTimers();
  renderColdStart();

  advance(6_000);
  const style = flatStyle(screen.getByTestId("splash-brand"));
  expect(style.width).toBe("100%");
  expect(style.textAlign).toBe("center");
});

// #871: the clock skips still holds instead of repainting the SVG tree.
test("the splash clock skips inactive windows but reaches each motion endpoint", () => {
  expect(nextSplashSampleMs(0)).toBe(420);
  expect(nextSplashSampleMs(420)).toBe(452);
  expect(nextSplashSampleMs(1_070)).toBe(1_500);
  expect(nextSplashSampleMs(2_995)).toBe(3_000);
  expect(nextSplashSampleMs(3_000)).toBe(3_460);
  expect(nextSplashSampleMs(3_820)).toBe(4_050);
  expect(nextSplashSampleMs(5_000)).toBe(5_550);
  expect(nextSplashSampleMs(6_000)).toBeNull();
});

test("cold start does not run any periodic whole-scene renderer", () => {
  jest.useFakeTimers();
  const intervals = jest.spyOn(global, "setInterval");
  renderColdStart();
  expect(intervals).not.toHaveBeenCalled();
});

test("head descends during its own phase, before the blink or side move", () => {
  jest.useFakeTimers();
  renderColdStart();
  advance(1_500);
  const headAtStart = svgProp("splash-head", "matrix");
  advance(600);
  const headDuringDrop = svgProp("splash-head", "matrix");
  expect(headDuringDrop).not.toEqual(headAtStart);
  advance(900);
  expect(svgProp("splash-head", "matrix")).not.toEqual(headDuringDrop);
  expect(screen.queryByTestId("screen-Explore")).toBeNull();
});

test("phase clock emits fewer scene updates than a fixed 32 ms interval", () => {
  let elapsed = 0;
  let samples = 0;
  for (;;) {
    const next = nextSplashSampleMs(elapsed);
    if (next === null) break;
    expect(next).toBeGreaterThan(elapsed);
    samples++;
    elapsed = next;
  }
  expect(samples).toBe(130);
  expect(Math.floor(SPLASH_DURATION_MS / 32)).toBe(218);
  expect(samples).toBeLessThan(Math.floor(SPLASH_DURATION_MS / 32));
});

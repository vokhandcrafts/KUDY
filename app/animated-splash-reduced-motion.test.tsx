// The entry transition respects the system's reduced-motion setting:
// app-entry-2026-10-19/README.md says the transition has no movement in
// that mode, and the current intro must not hold Explore behind its timer.
import { afterEach, expect, jest, test } from "@jest/globals";
import { renderRouter, screen } from "expo-router/testing-library";
import { useReducedMotion } from "react-native-reanimated";

import Explore from "./(tabs)/explore";
import Index from "./index";
import { createServices } from "../controllers/createServices";
import { layoutWith } from "../test/render-helpers";

const reducedMotion = useReducedMotion as unknown as { mockReturnValue: (value: boolean) => void };

afterEach(() => {
  reducedMotion.mockReturnValue(false);
  jest.useRealTimers();
});

test("reduced motion opens Explore immediately without playing the timed intro", () => {
  reducedMotion.mockReturnValue(true);
  jest.useFakeTimers();

  renderRouter(
    {
      _layout: layoutWith(createServices({})),
      index: Index,
      "(tabs)/explore": Explore,
    },
    { initialUrl: "/" },
  );

  expect(screen.getByTestId("screen-Explore")).toBeTruthy();
  expect(screen.queryByTestId("splash-scene")).toBeNull();
});

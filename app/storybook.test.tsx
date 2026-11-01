// DQ-13 (issue #914) — the route guards for the on-device Storybook
// (spec §4.4 B): outside __DEV__ the surface renders nothing (removing the
// gate turns this red) and in dev the route mounts the Storybook UI root.
// The UI root itself is the moduleNameMapper mock (jest.config.js): the real
// one needs the machine-local generated requires module and native peers
// jest cannot host. What a build bundles instead of the UI root — and the
// honest notice a dev build without EXPO_PUBLIC_STORYBOOK=1 shows — is
// covered by app/storybook-disabled.test.tsx and
// tools/metro-config/storybook-gate.test.mjs.
import { afterEach, describe, expect, test } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import Storybook from "./storybook";

const g = globalThis as { __DEV__?: boolean };

describe("DQ-13 (issue #914): the on-device Storybook route", () => {
  afterEach(() => {
    g.__DEV__ = true;
  });

  test("outside __DEV__ the route renders nothing — removing the gate turns this red", () => {
    g.__DEV__ = false;
    render(<Storybook />);
    expect(screen.queryByTestId("storybook/ui-root")).toBeNull();
    expect(screen.queryByTestId("storybook/disabled")).toBeNull();
  });

  test("in dev the route mounts the Storybook UI root", () => {
    g.__DEV__ = true;
    render(<Storybook />);
    expect(screen.getByTestId("storybook/ui-root")).toBeTruthy();
  });
});

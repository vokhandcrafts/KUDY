// DQ-13 (issue #914) — what a build without EXPO_PUBLIC_STORYBOOK=1 shows:
// withStorybook's {type: "empty"} branch leaves the root.tsx import a
// truthy empty exports object (Metro interop), so the dev route renders the
// honest notice (never a fake surface) and the production route renders
// nothing at all. The suite mocks the root module exactly as the empty
// branch ships it — a plain {} — mirroring the device runtime; the real
// mapper mock (storybook-ui-mock.tsx) covers the mounted case in
// app/storybook.test.tsx.
import { jest } from "@jest/globals";
import { afterEach, describe, expect, test } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

jest.mock("../.rnstorybook/root", () => ({}));

import Storybook from "./storybook";

const g = globalThis as { __DEV__?: boolean };

describe("DQ-13 (issue #914): the Storybook route without the env flag", () => {
  afterEach(() => {
    g.__DEV__ = true;
  });

  test("in dev the route shows the honest disabled notice — never a fake surface", () => {
    g.__DEV__ = true;
    render(<Storybook />);
    expect(screen.getByTestId("storybook/disabled")).toBeTruthy();
    expect(screen.getByTestId("storybook/disabled-text").props.children).toContain(
      "EXPO_PUBLIC_STORYBOOK=1",
    );
  });

  test("outside __DEV__ the route renders nothing", () => {
    g.__DEV__ = false;
    render(<Storybook />);
    expect(screen.queryByTestId("storybook/disabled")).toBeNull();
    expect(screen.queryByTestId("storybook/ui-root")).toBeNull();
  });
});

// UX 02 (issue #348) — the guard over the production layout itself: the
// Stack mounts with the native header off. Reverting app/_layout.tsx to a
// bare <Stack /> turns this red (implementation-rules 1 — the check fails
// when the fix is reverted).
import { describe, expect, jest, test } from "@jest/globals";
import { render } from "@testing-library/react-native";

let stackProps: { screenOptions?: Record<string, unknown> } = {};
jest.mock("expo-router", () => ({
  Stack: (props: { screenOptions?: Record<string, unknown> }) => {
    stackProps = props;
    return null;
  },
}));

// The mock above must be in place before the production layout is imported —
// this file's own Stack capture is the assertion target.
import RootLayout from "./_layout";

test("the production layout mounts the Stack with the native header off (AC1)", () => {
  render(<RootLayout />);
  expect(stackProps.screenOptions?.headerShown).toBe(false);
});

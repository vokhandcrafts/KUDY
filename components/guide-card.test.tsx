// G06.01.a (issue #313) — the responsive boundary of the scheme
// (screens-and-transitions.md, Explore row): one column below 821 px, two
// columns at 821 px and above. Colocated with the module it tests in
// components/ (issue #339 — moved out of app/ with guide-card.tsx).
import { describe, expect, test } from "@jest/globals";

import { isWide } from "./guide-card";

describe("responsive split (one column < 821 px, two ≥ 821 px)", () => {
  test("820 px stays one column, 821 px is the two-column edge", () => {
    expect(isWide(820)).toBe(false);
    expect(isWide(821)).toBe(true);
  });
});

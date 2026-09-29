// G06.05 (issue #280) — the big-text cap (AC2): every user-facing Text
// renders through ScaledText with the canon big-text factor as the maximum
// scaling multiplier — OS big text grows the words up to the a11y plate
// (≥ 1.2×, the canon is 1.25) and never past it, so the fixed surfaces hold.
// Removing the cap or the token turns this red (implementation-rules 1).
import { describe, expect, test } from "@jest/globals";
import { render } from "@testing-library/react-native";

import { tokens } from "./design-tokens";
import { ScaledText } from "./scaled-text";

describe("ScaledText (G06.05 AC2)", () => {
  test("the canon big-text factor caps the OS font scaling", () => {
    expect(tokens.fontBigTextFactor).toBe(1.25);
    const { getByText } = render(<ScaledText>Прывітанне</ScaledText>);
    expect(getByText("Прывітанне").props.maxFontSizeMultiplier).toBe(1.25);
    expect(getByText("Прывітанне").props.allowFontScaling).not.toBe(false);
  });
});

// G06.10.f (issue #406) — the walk-progress suite: the fill eases on the
// reanimated base (one shared pace for the fill and the figure), the
// optional figure cross-fades, and the reduce-motion setting lands both
// instantly — the two paths of the base's system-aware mode (AC2). The jest
// stand-in (test/reanimated-mock.js via the jest.config mapping) makes every
// animation land on its target, so the assertions stay final-state.
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import * as Reanimated from "react-native-reanimated";
import { useReducedMotion } from "react-native-reanimated";

import { tokens } from "./design-tokens";
import { WalkProgress } from "./walk-progress";

// The controllable seam: the stand-in module's stub the component reads
// (typed locally — the repo's tests keep to spyOn and plain casts).
const reducedMotion = useReducedMotion as unknown as { mockReturnValue: (value: boolean) => void };

// The merged style of one host node: the component paints arrays (canon
// track + consumer layout; fill + animated width; figure + animated opacity).
const mergedStyle = (node: { props: { style?: unknown } }): Record<string, unknown> => {
  const parts = [node.props.style].flat() as (Record<string, unknown> | null | undefined)[];
  return Object.assign({}, ...parts.filter(Boolean));
};

describe("G06.10.f walk progress (issue #406)", () => {
  afterEach(() => {
    reducedMotion.mockReturnValue(false);
    jest.restoreAllMocks();
  });

  // AC1's render test: the animated component mounted with the canon track —
  // and the mount itself starts no animation (the bar appears at its own
  // value; only a change eases).
  test("AC1: mounted with the canon 6px track and token colors — nothing animates on mount", () => {
    const spy = jest.spyOn(Reanimated, "withTiming");
    render(<WalkProgress progress={0.25} />);
    const track = mergedStyle(screen.getByTestId("walk-progress"));
    expect(track.height).toBe(6);
    expect(track.backgroundColor).toBe(tokens.colorLine);
    expect(track.borderColor).toBe(tokens.colorMuted);
    const fill = mergedStyle(screen.getByTestId("walk-progress-fill"));
    expect(fill.backgroundColor).toBe(tokens.colorAccent);
    expect(fill.width).toBe("25%");
    expect(spy).not.toHaveBeenCalled();
  });

  // AC1: a change eases to the new value — withTiming carries the shared
  // pace; reverting the fill to the static percent-width style turns this
  // red (the Proof).
  test("AC1: the fill eases to the new value — withTiming carries the shared pace", () => {
    const spy = jest.spyOn(Reanimated, "withTiming");
    const { rerender } = render(<WalkProgress progress={0.25} />);
    rerender(<WalkProgress progress={0.8} />);
    expect(spy).toHaveBeenCalledWith(80, expect.objectContaining({ duration: 400 }));
    expect(mergedStyle(screen.getByTestId("walk-progress-fill")).width).toBe("80%");
  });

  // AC1: the figure, where shown, cross-fades — the outgoing word fades out
  // while the incoming fades in, both on the fill's pace.
  test("AC1: the figure cross-fades — the outgoing layer fades out, the incoming in", () => {
    const spy = jest.spyOn(Reanimated, "withTiming");
    const { rerender } = render(<WalkProgress progress={0.25} figure="25%" />);
    rerender(<WalkProgress progress={0.75} figure="75%" />);
    const previous = screen.getByTestId("walk-progress-figure-previous", { includeHiddenElements: true });
    expect(previous.props.children).toBe("25%");
    expect(mergedStyle(previous).opacity).toBe(0);
    const current = screen.getByTestId("walk-progress-figure");
    expect(current.props.children).toBe("75%");
    expect(mergedStyle(current).opacity).toBe(1);
    expect(spy).toHaveBeenCalledWith(0, expect.objectContaining({ duration: 400 }));
    expect(spy).toHaveBeenCalledWith(1, expect.objectContaining({ duration: 400 }));
  });

  // AC2: with the reduce-motion setting on (the stub here, the base's own
  // system-aware mode on device), a change applies the final width
  // immediately — no transition values present.
  test("AC2: with reduce-motion on, a change lands at the final width instantly", () => {
    reducedMotion.mockReturnValue(true);
    const spy = jest.spyOn(Reanimated, "withTiming");
    const { rerender } = render(<WalkProgress progress={0.25} />);
    rerender(<WalkProgress progress={0.8} />);
    expect(mergedStyle(screen.getByTestId("walk-progress-fill")).width).toBe("80%");
    expect(spy).not.toHaveBeenCalled();
  });

  // AC2: the reduce-motion figure swap is instant — no outgoing layer, no
  // fades; stripping the reduce-motion branch turns this red (the Proof).
  test("AC2: with reduce-motion on, the figure swaps instantly — no outgoing layer", () => {
    reducedMotion.mockReturnValue(true);
    const spy = jest.spyOn(Reanimated, "withTiming");
    const { rerender } = render(<WalkProgress progress={0.25} figure="25%" />);
    rerender(<WalkProgress progress={0.75} figure="75%" />);
    expect(screen.queryByTestId("walk-progress-figure-previous", { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId("walk-progress-figure").props.children).toBe("75%");
    expect(spy).not.toHaveBeenCalled();
  });
});

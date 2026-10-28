// Accepted vector preview, quality v6 (2026-10-28). These guards cover the
// features the SVG tree can prove. The paw/head seams, roundness and subtle
// highlights still need rendered-frame inspection at phone scale.
import { expect, test } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { Path } from "react-native-svg";

import { AnimatedSplash } from "./animated-splash";

type SvgPathNode = { props: { d?: unknown; fill?: unknown } };

test("both raised paws have separate, contrasting vector claws", () => {
  render(<AnimatedSplash elapsedMs={1_200} brandName="KUDY" />);

  for (const side of ["left", "right"] as const) {
    const paw = screen.getByTestId(`splash-paw-${side}`);
    const claws = screen.getByTestId(`splash-claws-${side}`);
    const clawPaths: SvgPathNode[] = claws.findAllByType(Path);
    const pawPaths: SvgPathNode[] = paw.findAllByType(Path);
    const pawFill = pawPaths[0]?.props.fill;

    expect(clawPaths.length).toBeGreaterThanOrEqual(3);
    expect(new Set(clawPaths.map((path) => String(path.props.d ?? ""))).size).toBeGreaterThanOrEqual(3);
    expect(clawPaths.some((path) => {
      const fill = path.props.fill ?? claws.props.fill;
      return typeof fill === "string" && fill !== "none" && fill !== pawFill;
    })).toBe(true);
  }
});

test("two vector eye outlines fade with the eyes during the blink", () => {
  const { rerender } = render(<AnimatedSplash elapsedMs={3_300} brandName="KUDY" />);
  const outlines = screen.getByTestId("splash-eye-outlines");
  const paths: SvgPathNode[] = outlines.findAllByType(Path);
  const contourCount = paths.reduce(
    (count, path) => count + (String(path.props.d ?? "").match(/[Mm]/g)?.length ?? 0),
    0,
  );

  expect(contourCount).toBeGreaterThanOrEqual(2);
  expect(outlines.props.opacity ?? 1).toBe(1);
  rerender(<AnimatedSplash elapsedMs={3_650} brandName="KUDY" />);
  expect(screen.getByTestId("splash-eye-outlines").props.opacity).toBe(0);
});

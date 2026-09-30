// G06.10.e (issue #405) — the paper-surface suite: the grain layer renders
// under the content and consumes the layer token — the file-level mock
// overrides the mirror's opacity with a synthetic value, so a hardcoded
// canon literal in the wrapper fails the opacity assertion
// (implementation-rules 1: the reverted-line check). The layer is
// decorative: hidden from the accessibility tree — the screen-reader tree
// of a surface is its content, never the texture.
import { describe, expect, jest, test } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { PaperSurface } from "./paper-surface";

// The synthetic override differs from the canon 0.05 on purpose: the
// assertion reads the mock's value, so only a wrapper that actually
// consumes the mirror paints the overridden opacity.
jest.mock("./design-tokens", () => {
  const actual = jest.requireActual("./design-tokens") as { tokens: Record<string, unknown> };
  return { tokens: { ...actual.tokens, texturePaperGrainOpacity: 0.5 } };
});

function renderSurface() {
  return render(
    <PaperSurface testID="surface">
      <Text style={{ fontSize: 16 }}>Зярно паперы</Text>
    </PaperSurface>,
  );
}

type HostNode = { props?: { testID?: string; style?: unknown; source?: unknown } } | null;

function mergedStyle(node: HostNode): Record<string, unknown> {
  return Object.assign(
    {},
    ...[node?.props?.style].flat(Infinity).filter((s) => s && typeof s === "object"),
  ) as Record<string, unknown>;
}

// The layer is hidden from the accessibility tree, so the default RNTL
// queries (which walk the a11y tree) never see it — the render-tree view
// needs includeHiddenElements (that split is the a11y test itself).
function grainLayer() {
  return screen.getByTestId("paper-grain", { includeHiddenElements: true }) as unknown as HostNode;
}

describe("PaperSurface (G06.10.e)", () => {
  test("the grain layer renders under the content at the mirror opacity", () => {
    renderSurface();
    const grain = grainLayer();
    expect(grain?.props?.source).toBeDefined();
    expect((grain?.props as { resizeMode?: string })?.resizeMode).toBe("repeat");
    expect(mergedStyle(grain).opacity).toBe(0.5);
    // The way React Native paints the stack: the grain is the surface's
    // first child, the content renders above it.
    const tree = screen.toJSON() as { children?: HostNode[] };
    expect(tree.children?.[0]?.props?.testID).toBe("paper-grain");
    expect(tree.children?.[1]?.props?.testID).toBeUndefined();
  });

  test("children render above the grain and carry none of it", () => {
    renderSurface();
    expect(screen.getByText("Зярно паперы")).toBeTruthy();
    const tree = screen.toJSON() as { props?: { testID?: string }; children?: HostNode[] };
    expect(tree.props?.testID).toBe("surface");
    expect(mergedStyle(tree.children?.[1] ?? null).opacity).toBeUndefined();
    // The paper underneath is the canon token through the mirror, not a
    // screen-side literal.
    expect(mergedStyle(screen.getByTestId("surface") as unknown as HostNode).backgroundColor).toBe(
      "#faf7f2",
    );
  });

  test("the layer is invisible to the accessibility tree", () => {
    renderSurface();
    // The default queries walk the a11y tree: the decorative layer is not
    // there — the screen-reader tree of the surface is its content only.
    expect(screen.queryByTestId("paper-grain")).toBeNull();
    const grain = grainLayer();
    expect(grain?.props).toMatchObject({
      accessible: false,
      accessibilityElementsHidden: true,
      importantForAccessibility: "no-hide-descendants",
    });
  });
});

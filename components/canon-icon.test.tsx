// G06.10.c (issue #403) — the icon layer's own contract, each check a
// fail-on-revert guard (implementation-rules 1): color and size resolve from
// the canon tokens at render time (overriding a token changes the output — a
// literal in the component would freeze it), the screen-reader label is
// required on every rendering (canon §9 — an empty label throws, it is never
// silently decorative), the glyph rides a deep per-glyph import (the source
// scan turns any barrel import of the icon package red), and the wrapper
// composes inside a Pressable without stealing the press.
import { afterEach, describe, expect, test } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react-native";
import { Svg } from "react-native-svg";

import MapPin from "lucide-react-native/icons/map-pin";

import { CanonIcon } from "./canon-icon";
import { tokens } from "./design-tokens";
import { uiStrings } from "./ui-strings";

// The canon `tokens` object is readonly by type; the override experiment
// mutates it at runtime and restores it — the same values the guard suite
// pins to the canon machine block.
const mutableTokens = tokens as unknown as { colorInk: string; fontBaseSize: number };
const canonColor = tokens.colorInk;
const canonSize = tokens.fontBaseSize;

afterEach(() => {
  mutableTokens.colorInk = canonColor;
  mutableTokens.fontBaseSize = canonSize;
});

function svgOf(wrapper: ReturnType<typeof render>) {
  return wrapper.UNSAFE_getByType(Svg);
}

describe("CanonIcon (G06.10.c)", () => {
  test("color and size resolve from the canon tokens — overriding a token changes the output", () => {
    const canon = render(<CanonIcon glyph={MapPin} label="Кропкі" testID="icon-tokens" />);
    expect(svgOf(canon).props.stroke).toBe(canonColor);
    expect(svgOf(canon).props.width).toBe(canonSize);
    expect(svgOf(canon).props.height).toBe(canonSize);

    mutableTokens.colorInk = "#0a0b0c";
    mutableTokens.fontBaseSize = 21;
    const overridden = render(<CanonIcon glyph={MapPin} label="Кропкі" testID="icon-tokens" />);
    expect(svgOf(overridden).props.stroke).toBe("#0a0b0c");
    expect(svgOf(overridden).props.width).toBe(21);
  });

  test("explicit color and size props override the token defaults (pressable composition)", () => {
    const tree = render(<CanonIcon glyph={MapPin} label="Кропкі" color="#1d6b4f" size={24} />);
    expect(svgOf(tree).props.stroke).toBe("#1d6b4f");
    expect(svgOf(tree).props.width).toBe(24);
  });

  test("the label is visible to accessibility tooling; an empty label is a contract breach", () => {
    const tree = render(<CanonIcon glyph={MapPin} label="Кропкі" testID="icon-labelled" />);
    expect(tree.getByTestId("icon-labelled").props.accessible).toBe(true);
    expect(tree.getByTestId("icon-labelled").props.accessibilityLabel).toBe("Кропкі");

    expect(() => render(<CanonIcon glyph={MapPin} label="" />)).toThrow(
      "CanonIcon: the screen-reader label is required",
    );
    expect(() => render(<CanonIcon glyph={MapPin} label="   " />)).toThrow(
      "CanonIcon: the screen-reader label is required",
    );
  });

  test("the label contract carries the EN catalog words (AC4, EN)", () => {
    // The display locale is 'be' until L02 lands; the EN word rides the same
    // required-label contract — the glyph does not care which catalog spoke.
    const label = uiStrings("en").stopsCount(2);
    const tree = render(<CanonIcon glyph={MapPin} label={label} testID="icon-en" />);
    expect(tree.getByTestId("icon-en").props.accessibilityLabel).toBe("Stops: 2");
  });

  test("the wrapper never steals a press: pointerEvents none, style passthrough", () => {
    const tree = render(
      <CanonIcon glyph={MapPin} label="Кропкі" testID="icon-compose" style={{ marginTop: 2 }} />,
    );
    const wrapper = tree.getByTestId("icon-compose");
    expect(wrapper.props.pointerEvents).toBe("none");
    expect(wrapper.props.style).toEqual({ marginTop: 2 });
  });

  test("the glyph is the passed Lucide component, rendered deep (no barrel)", () => {
    // map-pin's class name rides the lucide Svg; a swapped glyph or a barrel
    // resolving to the wrong module changes it.
    const tree = render(<CanonIcon glyph={MapPin} label="Кропкі" />);
    expect(svgOf(tree).props.className).toBe("lucide lucide-map-pin");
  });
});

// The source check of AC3: every import of the icon package in the app
// source zones is a deep per-glyph import ("lucide-react-native/icons/<name>")
// — the package root and its ./icons barrel stay unimported (Metro does not
// tree-shake barrels; one barrel import drags the whole glyph set in).
const SOURCE_ROOTS = ["app", "components"];
const BARREL_IMPORT = /from\s+["']lucide-react-native(\/icons)?["']/;

function* sourceFiles(root: string): Generator<string> {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) yield path;
  }
}

test("no barrel import of the icon package anywhere in app/ and components/", () => {
  const offenders: string[] = [];
  for (const root of SOURCE_ROOTS) {
    for (const path of sourceFiles(root)) {
      const text = readFileSync(path, "utf8");
      if (BARREL_IMPORT.test(text)) offenders.push(path);
    }
  }
  expect(offenders).toEqual([]);
});

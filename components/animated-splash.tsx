import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { ClipPath, Defs, Ellipse, G, Path, Rect } from "react-native-svg";

import paths from "../assets/kudy-splash/dragon-paths.json";
import { tokens } from "./design-tokens";

export const SPLASH_DURATION_MS = 7_000;

const paper = "#F5EDDF";
const muzzle = "#e4bd8f";
const face = "#743d25";

function ease(value: number): number {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
}

function segment(time: number, start: number, end: number, from: number, to: number): number {
  return from + (to - from) * ease((time - start) / (end - start));
}

const Part = memo(function Part({ name }: { name: keyof typeof paths }) {
  const part = paths[name];
  return (
    <G transform={part.transform || undefined} fill={part.fill}>
      <Path d={part.d} stroke={part.stroke} strokeWidth={part.strokeWidth} strokeLinejoin="round" />
    </G>
  );
});

type SplashHeadProps = {
  side: number;
  headY: number;
  facing: number;
  blink: number;
  mouth: string;
  open: number;
};

// The SVG geometry stays mounted while only the moving group changes.
const SplashHead = memo(function SplashHead({ side, headY, facing, blink, mouth, open }: SplashHeadProps) {
  return (
            <G testID="splash-head" transform={`translate(${side} ${headY})`}>
              <G transform={`translate(512 0) scale(${facing} 1) translate(-512 0)`}>
                <Part name="hornNear" />
                <Part name="hornFar" />
                <G fill="none" stroke="#f3c783" strokeLinecap="round" opacity={0.8}>
                  <Path d="M447 196 C485 155 530 136 566 120" strokeWidth={13} />
                  <Path d="M712 294 C748 270 787 250 821 220" strokeWidth={8} opacity={0.55} />
                </G>
                <Part name="head" />
                <Path d="M652 318 C661 323 668 332 675 342" fill="none" stroke="#492719" strokeWidth={4.5} strokeLinecap="round" opacity={0.58} />
                <Path d="M448 302 C468 287 497 284 521 290 C501 290 475 297 454 307 Q448 309 448 302Z" fill="#bb7650" opacity={0.58} />
                <G testID="splash-eyes" opacity={1 - blink}>
                  <Part name="eyeWhite" />
                  <Part name="pupils" />
                </G>
                <G opacity={blink} fill={face}>
                  <Ellipse cx={310} cy={445} rx={131} ry={135} />
                  <Ellipse cx={682} cy={580} rx={139} ry={140} />
                </G>
                <G opacity={blink} fill="none" stroke="#432315" strokeWidth={10} strokeLinecap="round">
                  <Path d="M210 449 Q310 497 410 449" />
                  <Path d="M570 574 Q683 630 797 574" />
                </G>
                <Ellipse cx={580} cy={850} rx={115} ry={91} fill={muzzle} clipPath="url(#splash-patch-limit)" />
                <Part name="jaw" />
                <G testID="splash-eye-outlines" opacity={1 - blink}><Part name="eyeRim" /></G>
                <Path testID="splash-mouth" d={mouth} fill="#2e150b" stroke="#432315" strokeWidth={13 - 5 * open} strokeLinecap="round" strokeLinejoin="round" />
                <Path d="M379 752 Q414 734 458 749 Q426 777 379 752Z" fill="#C56D65" opacity={Math.max(0, (open - 0.45) * 0.8)} />
              </G>
            </G>
  );
});

const SplashPawLeft = memo(function SplashPawLeft({ y }: { y: number }) {
  return (
            <G testID="splash-paw-left" transform={`translate(0 ${y})`}>
              <G transform="translate(295 966) scale(1.06 1.12) translate(-295 -966)"><Part name="pawL" /></G>
              <G testID="splash-claws-left" transform="translate(0 8)" fill="#f8deb4" stroke="#743d25" strokeWidth={2.5} strokeLinejoin="round">
                <Path d="M203 906 C209 900 221 903 224 911 C226 923 219 936 215 944 C208 938 204 925 203 906Z" fill="#f8deb4" />
                <Path d="M259 914 C265 907 278 910 281 920 C282 930 277 946 273 953 C265 946 261 933 259 914Z" fill="#f8deb4" />
                <Path d="M316 909 C322 903 334 906 337 915 C339 927 332 940 328 947 C321 940 317 927 316 909Z" fill="#f8deb4" />
              </G>
            </G>
  );
});

const SplashPawRight = memo(function SplashPawRight({ y }: { y: number }) {
  return (
            <G testID="splash-paw-right" transform={`translate(0 ${y})`}>
              <G transform="translate(695 966) scale(1.06 1.12) translate(-695 -966)"><Part name="pawR" /></G>
              <G testID="splash-claws-right" transform="translate(0 8)" fill="#f8deb4" stroke="#743d25" strokeWidth={2.5} strokeLinejoin="round">
                <Path d="M602 909 C608 903 620 906 623 915 C625 927 618 940 614 947 C607 940 603 927 602 909Z" fill="#f8deb4" />
                <Path d="M659 914 C665 907 678 910 681 920 C682 930 677 946 673 953 C665 946 661 933 659 914Z" fill="#f8deb4" />
                <Path d="M715 906 C721 900 733 903 736 911 C738 923 731 936 727 944 C720 938 716 925 715 906Z" fill="#f8deb4" />
              </G>
            </G>
  );
});

const SplashBrand = memo(function SplashBrand({ brandName, brandOpacity }: { brandName: string; brandOpacity: number }) {
  return <Text testID="splash-brand" style={[styles.brand, { opacity: brandOpacity }]}>{brandName}</Text>;
});

// No React updates while the picture is motionless. During each moving window
// only the changing head/paw/word group renders; the static paths stay memoized.
const SPLASH_MOTION_WINDOWS = [
  [420, 1_070], [1_500, 3_000], [3_460, 3_820],
  [4_050, 5_000], [5_550, 6_000],
] as const;

export function nextSplashSampleMs(elapsedMs: number): number | null {
  for (const [start, end] of SPLASH_MOTION_WINDOWS) {
    if (elapsedMs < start) return start;
    if (elapsedMs < end) return Math.min(end, elapsedMs + 32);
  }
  return null;
}

export function AnimatedSplash({ elapsedMs, brandName }: { elapsedMs: number; brandName: string }) {
  const time = Math.max(0, Math.min(SPLASH_DURATION_MS, elapsedMs));
  const leftPawY = time < 420 ? 230 : time < 760 ? segment(time, 420, 760, 230, 0) : 0;
  const rightPawY = time < 720 ? 230 : time < 1_070 ? segment(time, 720, 1_070, 230, 0) : 0;
  const headY = time < 1_500 ? 940 : time < 2_700
    ? segment(time, 1_500, 2_700, 940, -13)
    : time < 3_000 ? segment(time, 2_700, 3_000, -13, 0) : 0;
  const side = time < 3_550 ? 0 : time < 3_620
    ? segment(time, 3_550, 3_620, 0, -22)
    : time < 3_730 ? segment(time, 3_620, 3_730, 22, 0) : 0;
  const facing = time < 3_620 ? -1 : 1;
  const blink = time < 3_460 ? 0 : time < 3_550
    ? segment(time, 3_460, 3_550, 0, 1)
    : time < 3_730 ? 1
    : time < 3_820 ? segment(time, 3_730, 3_820, 1, 0) : 0;
  const open = time < 4_050 ? 0 : time < 4_350
    ? segment(time, 4_050, 4_350, 0, 1)
    : time < 4_650 ? 1
    : time < 5_000 ? segment(time, 4_650, 5_000, 1, 0) : 0;
  const mouth = `M314 622 C350 704 430 728 528 701 C${430 - 12 * open} ${728 + 68 * open} ${350 + 16 * open} ${704 + 108 * open} 314 622 Z`;
  const brandOpacity = time < 5_550 ? 0 : time < 6_000 ? ease((time - 5_550) / 450) : 1;

  return (
    <View style={styles.screen}>
      <View style={styles.mark}>
        <Svg testID="splash-scene" width="100%" height="100%" viewBox="0 0 1024 1024" accessibilityLabel={brandName}>
          <Rect width={1024} height={1024} fill={paper} />
          <Defs>
            <ClipPath id="splash-window"><Rect x={51} y={50} width={921} height={912} rx={147} /></ClipPath>
            <ClipPath id="splash-patch-limit"><Rect width={1024} height={915} /></ClipPath>
          </Defs>
          <G clipPath="url(#splash-window)">
            <SplashHead side={side} headY={headY} facing={facing} blink={blink} mouth={mouth} open={open} />
            <SplashPawLeft y={leftPawY} />
            <SplashPawRight y={rightPawY} />
          </G>
          <Part name="frame" />
        </Svg>
      </View>
      <SplashBrand brandName={brandName} brandOpacity={brandOpacity} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: paper,
  },
  mark: {
    width: "76%",
    maxWidth: 280,
    aspectRatio: 1,
  },
  brand: {
    // Full-width line with centered ink, never a content-sized box: Yoga
    // measures the word at mount with the system fallback, and when
    // GolosText arrives later Android re-wraps the wider face inside the
    // stale one-line box — the Y fell onto a clipped second line and the
    // word read «KUD». A screen-wide line cannot re-wrap, so the late face
    // swap only re-centers the ink (app/animated-splash.test.tsx guards it).
    width: "100%",
    textAlign: "center",
    marginTop: 14,
    color: face,
    fontFamily: tokens.fontFamilyUiStrong,
    fontSize: 53,
    lineHeight: 55,
    letterSpacing: 2.4,
  },
});

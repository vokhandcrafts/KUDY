import { StyleSheet, Text, View } from "react-native";
import Svg, { ClipPath, Defs, Ellipse, G, Path, Rect } from "react-native-svg";

import paths from "../assets/kudy-splash/dragon-paths.json";
import { tokens } from "./design-tokens";
import { uiStrings } from "./ui-strings";

export const SPLASH_DURATION_MS = 7_000;

const sourceTransform = "translate(0 1024) scale(0.2 -0.2)";
const paper = "#F5EDDF";
const muzzle = "#e4bd8f";
const face = "#743d25";
const paw = "#a85f35";
const brandName = uiStrings("be").myKudy;

function ease(value: number): number {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
}

function segment(time: number, start: number, end: number, from: number, to: number): number {
  return from + (to - from) * ease((time - start) / (end - start));
}

function Part({ name }: { name: keyof typeof paths }) {
  const part = paths[name];
  return (
    <G transform={sourceTransform} fill={part.fill}>
      <Path d={part.d} />
    </G>
  );
}

export function AnimatedSplash({ elapsedMs }: { elapsedMs: number }) {
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
            <G testID="splash-head" transform={`translate(${side} ${headY})`}>
              <G transform={`translate(512 0) scale(${facing} 1) translate(-512 0)`}>
                <Part name="head" />
                <Part name="horns" />
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
                <Path testID="splash-mouth" d={mouth} fill="#2e150b" stroke="#432315" strokeWidth={13 - 5 * open} strokeLinecap="round" strokeLinejoin="round" />
                <Path d="M379 752 Q414 734 458 749 Q426 777 379 752Z" fill="#C56D65" opacity={Math.max(0, (open - 0.45) * 0.8)} />
              </G>
            </G>
            <G testID="splash-paw-left" transform={`translate(0 ${leftPawY})`}>
              <Path d="M178 900 H410 Q419 934 416 966 H174 Q170 934 178 900Z" fill={paw} />
              <G transform="translate(295 966) scale(1.06 1.12) translate(-295 -966)"><Part name="pawL" /></G>
            </G>
            <G testID="splash-paw-right" transform={`translate(0 ${rightPawY})`}>
              <Path d="M570 900 H808 Q820 934 816 966 H566 Q562 934 570 900Z" fill={paw} />
              <G transform="translate(695 966) scale(1.06 1.12) translate(-695 -966)"><Part name="pawR" /></G>
            </G>
          </G>
          <Part name="frame" />
        </Svg>
      </View>
      <Text testID="splash-brand" style={[styles.brand, { opacity: brandOpacity }]}>{brandName}</Text>
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
    marginTop: 14,
    color: face,
    fontFamily: tokens.fontFamilyUiStrong,
    fontSize: 53,
    lineHeight: 55,
    letterSpacing: 2.4,
  },
});

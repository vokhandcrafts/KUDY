// G21.47 (issue #671) — the dev-only synthetic Han probe surface: the same
// fixture strings the G21.40 web probe used, rendered through the app's own
// text stack (ScaledText + the font tokens) so the device run observes RN
// Text, not Chrome. Renders nothing outside __DEV__ — no production surface,
// no locale activation: the strings are literals, the ui-locale store and
// the release flag are not touched (G21.50 stays the gate for zh).
//
// Machine files carry no raw CJK bytes: every Han string below is \uXXXX
// escape-encoded (gitguard keeps watching for raw Han), decoded at render
// time — the G21.40 idiom (spikes/G21.40-han-layout/fixtures.js, which owns
// the fixture values; this module copies only the rows the device run needs,
// reshaped, and is the single RN copy).
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ReactNode } from "react";

import { tokens } from "../components/design-tokens";
import { ScaledText } from "../components/scaled-text";
import { screenStyles } from "../components/screen-styles";

// Escape-encoded fixture rows (source: spikes/G21.40-han-layout/fixtures.js).
// Keys name the observed row, not the fixture section, so the machine JSON
// and the uiautomator dumps line up with this surface 1:1.
const han = {
  cardHans: "\u5e03\u62c9\u683c\u57ce\u5821\u5386\u53f2\u5efa\u7b51\u7fa4\u4e0e\u9ec4\u91d1\u5df7\u5bfc\u89c8",
  cardHant: "\u5e03\u62c9\u683c\u57ce\u5821\u6b77\u53f2\u5efa\u7bc9\u7fa4\u8207\u9ec3\u91d1\u5df7\u5c0e\u89bd",
  cardLongNoSpaces:
    "\u5e03\u62c9\u683c\u57ce\u5821\u5386\u53f2\u5efa\u7b51\u7fa4\u7b2c\u4e8c\u5ead\u9662\u4e0e\u9ec4\u91d1\u5df7\u8054\u7968\u552e\u7968\u5904\u5165\u53e3",
  cardPolish: "\u017belazowa Wola \u2014 \u0141\u00f3d\u017a \u0105\u0118\u0119 \u00d3\u00f3\u0144\u015b\u0107",
  durationMixed: "\u65f6\u957f 2\u5c0f\u65f630\u5206\u949f",
  dateMixed: "1873\u5e7410\u67086\u65e5\uff0c\u5f00\u653e\u81f318:00",
  primary: "\u5f00\u59cb\u6e38\u89c8",
  secondary: "\u4e0b\u8f7d\u79bb\u7ebf\u5305",
  disabled: "\u6682\u4e0d\u5f00\u653e",
  error: "\u9519\u8bef\uff1a\u5185\u5bb9\u4e0d\u53ef\u79bb\u7ebf\u4f7f\u7528\u3002\u8bf7\u8fde\u63a5\u7f51\u7edc\u540e\u91cd\u8bd5\uff08\u4ee3\u7801 E-1042\uff09\u3002",
  unavailable: "\u6b64\u7ad9\u70b9\u6682\u65e0\u4e2d\u6587\u8bd1\u6587",
  narrative:
    "\u57ce\u5821\u5efa\u4e8e\u516c\u5143880\u5e74\u524d\u540e\uff0c\u662f\u6b27\u6d32\u6700\u5927\u7684\u53e4\u5efa\u7b51\u7fa4\u4e4b\u4e00\u3002\u300c\u9ec4\u91d1\u5df7\u300d\u7684\u5c0f\u5c4b\u572816\u4e16\u7eaa\u4f4f\u8fc7\u91d1\u5320\uff0c1916\u5e74\u51ac\uff0c\u4f5c\u5bb6\u5361\u592b\u5361\u66fe\u5728\u8fd9\u91cc\u77ed\u6682\u5c45\u4f4f\u3002\u5168\u6bb5\u8bb2\u89e3\u7ea612\u5206\u949f\uff0c\u53ef\u5728\u79bb\u7ebf\u6a21\u5f0f\u6536\u542c\u3002",
  timer: "\u7b2c2\u7ad9 \u00b7 02\u520605\u79d2",
  audioLabel: "\u5df2\u6682\u505c \u00b7 12/24 \u7ad9\u70b9",
  // The G21.40 S2 shared codepoints with regional form differences (SC vs
  // TC vs JP members render these shapes differently) — the row the glyph
  // form check reads against the S2 reference screenshot.
  s2Shared: "\u9AA8\u76F4\u4EE4\u8FC7\u8FB9\u8BF7\u51C0\u6E29\u6D77\u8349",
} as const;

// The three scaling behaviors the device run separates: the app idiom
// (ScaledText, capped at font.big-text-factor), the raw uncapped Text
// (allowFontScaling default on, no cap), and the pinned Text.
const scalingRows = [
  { key: "scaled-cap", caption: "ScaledText (cap 1.25)", mode: "cap" },
  { key: "raw-full", caption: "Text, no cap", mode: "full" },
  { key: "pinned-off", caption: "allowFontScaling=false", mode: "pinned" },
] as const;

const styles = StyleSheet.create({
  actionsRow: { flexDirection: "row", gap: tokens.spaceS, marginTop: tokens.spaceS },
  btnDisabled: {
    backgroundColor: tokens.colorCard,
    borderColor: tokens.colorDisabledLine,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    color: tokens.colorDisabledInk,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize,
    paddingHorizontal: tokens.spaceM,
    paddingVertical: tokens.spaceS,
  },
  btnPrimary: {
    backgroundColor: tokens.colorAccent,
    borderRadius: tokens.radiusBase,
    color: tokens.colorAccentInk,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize,
    paddingHorizontal: tokens.spaceM,
    paddingVertical: tokens.spaceS,
  },
  btnSecondary: {
    backgroundColor: tokens.colorCard,
    borderColor: tokens.colorLine,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    color: tokens.colorInk,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize,
    paddingHorizontal: tokens.spaceM,
    paddingVertical: tokens.spaceS,
  },
  caption: {
    color: tokens.colorMuted,
    fontFamily: tokens.fontFamilyUi,
    fontSize: 12,
    marginTop: tokens.spaceM,
  },
  errorBox: {
    backgroundColor: tokens.colorErrorBg,
    borderColor: tokens.colorErrorBorder,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    marginTop: tokens.spaceS,
    padding: tokens.spaceM,
  },
  errorText: {
    color: tokens.colorInk,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize,
  },
  narrative: {
    color: tokens.colorInk,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize,
    lineHeight: tokens.fontBaseSize * 1.5,
    marginTop: tokens.spaceS,
  },
  row: {
    color: tokens.colorInk,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize,
  },
  rowStrong: {
    color: tokens.colorInk,
    fontFamily: tokens.fontFamilyUiStrong,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
  },
  s2Giant: {
    color: tokens.colorInk,
    fontFamily: tokens.fontFamilyUi,
    fontSize: 48,
  },
});

function ProbeRow({ testId, caption, children }: { testId: string; caption: string; children: ReactNode }) {
  return (
    <View>
      <Text style={styles.caption}>{caption}</Text>
      <View testID={`han-probe/${testId}`}>{children}</View>
    </View>
  );
}

export default function HanProbe() {
  if (!__DEV__) return null;
  return (
    <HanProbeSurface />
  );
}

// The hook lives on the inner component: the __DEV__ gate above must sit
// before any hook call so the release build never mounts the surface (the
// rules-of-hooks order — a hook after an early return is a lint error).
function HanProbeSurface() {
  // UX 02 (issue #348) idiom: the frame's insets on the root style — at 200%
  // font scale the first row would climb under the status bar and the last
  // row would sink behind the gesture bar without them (observed in the
  // first device pass, fixed here before the recorded runs).
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={screenStyles.screen}
      // The insets ride the content container, not the frame: a scrollable
      // frame padding shrinks the viewport but the scroll extent never
      // includes it, so the last rows stay unreachable behind the gesture
      // bar (observed in the first device pass). Inside the content
      // container the inset space scrolls with the rows — the canonical RN
      // scroll-insets pattern.
      contentContainerStyle={{
        paddingTop: insets.top + tokens.spaceL,
        paddingBottom: insets.bottom + tokens.spaceL,
      }}
      testID="screen-Han probe"
    >
      <ScaledText style={screenStyles.title} testID="han-probe/title">
        Han probe (G21.47)
      </ScaledText>

      <ProbeRow testId="card-hans" caption="card hans / ui 400 / scaled">
        <ScaledText style={styles.row}>{han.cardHans}</ScaledText>
      </ProbeRow>
      <ProbeRow testId="card-hans-strong" caption="card hans / ui strong 600 / scaled">
        <ScaledText style={styles.rowStrong}>{han.cardHans}</ScaledText>
      </ProbeRow>
      <ProbeRow testId="card-hant" caption="card hant / ui 400 / scaled">
        <ScaledText style={styles.row}>{han.cardHant}</ScaledText>
      </ProbeRow>
      <ProbeRow testId="card-long" caption="long name, no spaces / ui 400 / scaled">
        <ScaledText style={styles.row}>{han.cardLongNoSpaces}</ScaledText>
      </ProbeRow>
      <ProbeRow testId="card-polish" caption="latin-ext control / ui 400 / scaled">
        <ScaledText style={styles.row}>{han.cardPolish}</ScaledText>
      </ProbeRow>

      <ProbeRow testId="duration" caption="duration, digits+cjk">
        <ScaledText style={styles.row}>{han.durationMixed}</ScaledText>
      </ProbeRow>
      <ProbeRow testId="date" caption="date, digits+cjk">
        <ScaledText style={styles.row}>{han.dateMixed}</ScaledText>
      </ProbeRow>

      <View style={styles.actionsRow}>
        <Text style={styles.btnPrimary} testID="han-probe/action-primary">
          {han.primary}
        </Text>
        <Text style={styles.btnSecondary} testID="han-probe/action-secondary">
          {han.secondary}
        </Text>
        <Text style={styles.btnDisabled} testID="han-probe/action-disabled">
          {han.disabled}
        </Text>
      </View>

      <ProbeRow testId="error" caption="error state">
        <View style={styles.errorBox}>
          <ScaledText style={styles.errorText}>{han.error}</ScaledText>
        </View>
      </ProbeRow>
      <ProbeRow testId="unavailable" caption="unavailable state">
        <ScaledText style={styles.row}>{han.unavailable}</ScaledText>
      </ProbeRow>

      <ProbeRow testId="narrative" caption="narrative / ui 400 / scaled">
        <ScaledText style={styles.narrative}>{han.narrative}</ScaledText>
      </ProbeRow>

      <ProbeRow testId="timer" caption="timer / digits+cjk / middle dot">
        <ScaledText style={styles.row}>{han.timer}</ScaledText>
      </ProbeRow>
      <ProbeRow testId="audio-label" caption="audio identity label">
        <ScaledText style={styles.row}>{han.audioLabel}</ScaledText>
      </ProbeRow>

      <ProbeRow testId="s2-shared" caption="S2 shared codepoints (regional forms)">
        <ScaledText style={styles.s2Giant}>{han.s2Shared}</ScaledText>
      </ProbeRow>

      {scalingRows.map((r) => (
        <ProbeRow key={r.key} testId={`scale-${r.key}`} caption={r.caption}>
          {r.mode === "pinned" ? (
            <Text allowFontScaling={false} style={styles.row}>
              {han.cardHans}
            </Text>
          ) : r.mode === "cap" ? (
            <ScaledText style={styles.row}>{han.cardHans}</ScaledText>
          ) : (
            <Text style={styles.row}>{han.cardHans}</Text>
          )}
        </ProbeRow>
      ))}
    </ScrollView>
  );
}

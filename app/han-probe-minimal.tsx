// G21.47 follow-up (issue #718) — the minimal reproduction surface for the
// uncapped-Text wrong-glyph defect the G21.47 device run observed at system
// font_scale 2.0 (a wrong glyph at the U+53F2 position, correct accessibility
// string, advance ≈1.8×). The G21.47 surface renders the string among 19
// rows through ScaledText and mixed components; this surface isolates the
// raw uncapped `Text` with nothing else, plus two discriminator rows the
// root-cause step reads:
//   - raw-default-font: the same uncapped Text without the app font family —
//     separates the app face (GolosText) from the framework scale path;
//   - size-control: allowFontScaling=false at double the base size — the
//     same final pixel size as 1× base at font_scale 2.0, reached without
//     the fontScale path at all.
// Renders nothing outside __DEV__ (the han-probe.tsx guard idiom); no
// production surface, no locale activation — zh stays behind G21.50.
//
// Machine files carry no raw CJK bytes: the Han string below is \uXXXX
// escape-encoded (the gitguard idiom), decoded at render time.
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { tokens } from "../components/design-tokens";
import { screenStyles } from "../components/screen-styles";

// The G21.47 probe string (escape-encoded; source: app/han-probe.tsx).
const probeString =
  "\u5e03\u62c9\u683c\u57ce\u5821\u5386\u53f2\u5efa\u7b51\u7fa4\u4e0e\u9ec4\u91d1\u5df7\u5bfc\u89c8";

const styles = StyleSheet.create({
  caption: {
    color: tokens.colorMuted,
    fontFamily: tokens.fontFamilyUi,
    fontSize: 12,
    marginTop: tokens.spaceL,
  },
  rawDefault: {
    color: tokens.colorInk,
    fontSize: tokens.fontBaseSize,
  },
  rawUi: {
    color: tokens.colorInk,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize,
  },
  sizeControl: {
    color: tokens.colorInk,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize * 2,
  },
});

export default function HanProbeMinimal() {
  if (!__DEV__) return null;
  return <HanProbeMinimalSurface />;
}

// The hook lives on the inner component: the __DEV__ gate above must sit
// before any hook call (the han-probe.tsx rules-of-hooks idiom).
function HanProbeMinimalSurface() {
  // The han-probe.tsx insets idiom: on the content container, not the frame.
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={screenStyles.screen}
      contentContainerStyle={{
        paddingTop: insets.top + tokens.spaceL,
        paddingBottom: insets.bottom + tokens.spaceL,
      }}
      testID="screen-Han probe minimal"
    >
      <View testID="han-minimal/raw-ui">
        <Text style={styles.rawUi}>{probeString}</Text>
      </View>
      <Text style={styles.caption}>raw Text, ui family, uncapped — the minimal case</Text>

      <View testID="han-minimal/raw-default-font">
        <Text style={styles.rawDefault}>{probeString}</Text>
      </View>
      <Text style={styles.caption}>raw Text, no fontFamily, uncapped</Text>

      <View testID="han-minimal/size-control">
        <Text allowFontScaling={false} style={styles.sizeControl}>
          {probeString}
        </Text>
      </View>
      <Text style={styles.caption}>allowFontScaling=false, 2x base size</Text>
    </ScrollView>
  );
}

// UX 02 (issue #348) — the shared screen-frame styles of the detail
// surfaces (route preview, place detail): the paper container and the
// section title. One copy — sibling StyleSheets are jscpd clones
// (implementation-rules 3).
import { StyleSheet } from "react-native";

import { tokens } from "./design-tokens";

// Issue #435: canon §3 gives Alegreya the guide and story names only —
// every other screen title (rubrics, place names, collections) stays on
// the UI family. The display role is the separate style below; the guard
// in test/design-tokens.test.mjs tracks who consumes it.
const titleBase = {
  color: tokens.colorInk,
  fontSize: tokens.fontTitleSize,
  fontWeight: tokens.fontWeightStrong,
  marginBottom: tokens.spaceS,
};

export const screenStyles = StyleSheet.create({
  screen: {
    backgroundColor: tokens.colorPaper,
    flex: 1,
    padding: tokens.spaceL,
  },
  title: {
    ...titleBase,
    fontFamily: tokens.fontFamilyUi,
  },
  displayTitle: {
    ...titleBase,
    // G06.10.b: while the face loads (and in tests) the unknown family
    // name falls back to the system font, weight and size hold.
    fontFamily: tokens.fontFamilyDisplay,
  },
});

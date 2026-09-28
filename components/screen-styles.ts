// UX 02 (issue #348) — the shared screen-frame styles of the detail
// surfaces (route preview, place detail): the paper container and the
// section title. One copy — sibling StyleSheets are jscpd clones
// (implementation-rules 3).
import { StyleSheet } from "react-native";

import { tokens } from "./design-tokens";

export const screenStyles = StyleSheet.create({
  screen: {
    backgroundColor: tokens.colorPaper,
    flex: 1,
    padding: tokens.spaceL,
  },
  title: {
    color: tokens.colorInk,
    fontSize: 18,
    fontWeight: tokens.fontWeightStrong,
    marginBottom: tokens.spaceS,
  },
});

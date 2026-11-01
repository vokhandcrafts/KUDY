// DQ-13 (issue #914) — the jest stand-in for the real .storybook UI root:
// the device UI pulls native peers (gesture-handler, bottom-sheet) jest
// cannot host, and the generated storybook.requires module is machine-local
// (gitignored). The route test only asserts which surface mounts, so the
// mock records its identity through a stable testID. Wired by the
// moduleNameMapper entry in jest.config.js; dropping the mapping loads the
// real UI root and the suite dies on the missing generated module.
import { View } from "react-native";

export default function StorybookUIRootMock() {
  return <View testID="storybook/ui-root" />;
}

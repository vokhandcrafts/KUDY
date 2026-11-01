// DQ-13 (issue #914) — the jest stand-in for the real .rnstorybook UI root:
// the device UI pulls the storybook runtime whose dist build jest cannot
// parse, plus native peers (gesture-handler, bottom-sheet) jest cannot host,
// and the generated storybook.requires module is machine-local (gitignored).
// The route test only asserts which surface mounts, so the mock records its
// identity through a stable testID. Wired by the moduleNameMapper entry in
// jest.config.js; dropping the mapping loads the real UI root and the suite
// dies on the storybook dist parse error.
import { View } from "react-native";

export default function StorybookUIRootMock() {
  return <View testID="storybook/ui-root" />;
}

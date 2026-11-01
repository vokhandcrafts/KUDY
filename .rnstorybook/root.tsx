// DQ-13 (issue #914) — the on-device Storybook UI root (spec §4.4 B,
// .rnstorybook is the @storybook/react-native 10 config dir). The generated
// requires module below is machine-local (gitignored, rebuilt by the
// storybook:generate npm script on postinstall) and registers the
// components/*.stories.tsx files — the same single source the dev-specimen
// screen reads, no second definition of states; it also creates the global
// View instance the UI mounts on. Remote control stays off (criterion 3):
// enableWebsockets is explicitly false, no host/port is given and the
// generator runs without --host, so the UI never opens a channel to a
// storybook server; story selection persists in memory only (the package
// ships no storage backend). The file is named root.tsx, not index.ts — the
// withStorybook disabled branch swaps an index.* entry for the package's
// stub module, while a non-index name falls to the wrapper's
// {type: "empty"} branch, so the production bundle keeps zero files of the
// @storybook packages (the stub ships two).
import { view } from "./storybook.requires";

export default view.getStorybookUI({
  enableWebsockets: false,
});

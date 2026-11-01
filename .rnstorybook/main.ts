// DQ-13 (issue #914) — the on-device Storybook build config (spec §4.4,
// .rnstorybook is the @storybook/react-native 10 config dir): the stories
// glob reads the same components/*.stories.tsx files the dev-specimen screen
// renders — the single source of component states, no second list. Telemetry
// is off (criterion 3); the storybook CLI server, its websockets remote
// control and the MCP server are never started — the repo runs only the
// generator (storybook:generate, no --host flag) and bundles the on-device
// UI (tools/metro-config/storybook-gate.test.mjs guards this).
import type { StorybookConfig } from "@storybook/react-native";

const main: StorybookConfig = {
  stories: ["../components/**/*.stories.tsx"],
  deviceAddons: ["@storybook/addon-ondevice-controls"],
  core: {
    disableTelemetry: true,
  },
};

export default main;

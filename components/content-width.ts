// APR-10.b (issue #959) — the one content-width cap of the screen bodies
// (canon token content.max-width): on windows ≥600dp the body keeps the
// canonical max width and centers; below the cap the style is inert
// (width 100% never exceeds the window), so one unconditional style serves
// every width. One copy — the screens never spell their own cap
// (implementation-rules 3); the render guard lives in
// app/content-width.test.tsx.
import { tokens } from "./design-tokens";

export const contentWidthStyle = {
  width: "100%",
  maxWidth: tokens.contentMaxWidth,
  alignSelf: "center",
} as const;

// #436 — a single native appearance boundary for system light/dark mode.
// The manual persisted preference belongs to #798; consumers use this hook
// rather than subscribing to Appearance or duplicating fallback rules.
import { useColorScheme } from "react-native";
import { darkTokens, tokens } from "./design-tokens";

export type ThemeScheme = "light" | "dark";

export function resolveThemeScheme(scheme: "light" | "dark" | null | undefined): ThemeScheme {
  return scheme === "dark" ? "dark" : "light";
}

export function statusBarStyle(theme: ThemeScheme): "dark" | "light" {
  // expo-status-bar uses "dark" for dark glyphs on light chrome.
  return theme === "dark" ? "light" : "dark";
}

export function useThemeScheme(): ThemeScheme {
  return resolveThemeScheme(useColorScheme());
}

export function useThemeTokens() {
  return useThemeScheme() === "dark" ? darkTokens : tokens;
}

export function useThemeStyles<Light, Dark>(light: Light, dark: Dark): Light | Dark {
  return useThemeScheme() === "dark" ? dark : light;
}

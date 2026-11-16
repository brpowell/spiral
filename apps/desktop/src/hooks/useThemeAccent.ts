import {
  DEFAULT_THEME_ID,
  findThemeById,
  resolveThemeTokens,
} from "@/lib/theme/theme";
import { useThemeStore } from "@/store/useThemeStore";

/** The active theme's accent colour, or undefined before themes load. */
export function useThemeAccent(): string | undefined {
  return useThemeStore((s) => {
    const theme =
      findThemeById(s.themes, s.activeThemeId) ??
      findThemeById(s.themes, DEFAULT_THEME_ID) ??
      s.themes[0];
    return theme ? resolveThemeTokens(theme)["color-accent"] : undefined;
  });
}

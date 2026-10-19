import type { CSSProperties } from "react";
import { resolveThemeTokens } from "../../lib/theme";
import type { Theme } from "../../types/theme";
import "./ThemesSection.css";

/** Background / surface / accent bands for a theme's tokens. */
export function ThemeSwatchPreview({
  theme,
}: {
  theme: Pick<Theme, "tokens">;
}) {
  const tokens = resolveThemeTokens(theme);
  const previewVars = {
    "--color-bg": tokens["color-bg"],
    "--color-text-primary": tokens["color-text-primary"],
    "--color-accent": tokens["color-accent"],
  } as CSSProperties;

  return (
    <span
      className="theme-picker__preview-vars theme-derived"
      style={previewVars}
    >
      <span className="theme-picker__preview-bg" />
      <span className="theme-picker__preview-surface" />
      <span className="theme-picker__preview-accent" />
    </span>
  );
}

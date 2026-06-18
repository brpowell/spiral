import type { Theme, ThemeTokens } from "../types/theme";

export const DEFAULT_THEME_ID = "Obsidian";

/** Full token set used for merge fallbacks (Obsidian). */
export const OBSIDIAN_DEFAULT_TOKENS: ThemeTokens = {
  "color-bg": "#0e0e10",
  "color-surface": "#1a1a1e",
  "color-surface-raised": "#242428",
  "color-text-primary": "#f0f0f0",
  "color-text-secondary": "#888899",
  "color-accent": "#7b8cde",
  "color-accent-muted": "#3a4170",
  "color-border": "#2a2a32",
  "color-danger": "#e06c75",
  "color-danger-bg": "#2a1518",
  "radius-card": "10px",
  "radius-button": "6px",
  "font-ui": "'Inter', system-ui, -apple-system, sans-serif",
};

export function mergeThemeTokens(partial: ThemeTokens): ThemeTokens {
  return { ...OBSIDIAN_DEFAULT_TOKENS, ...partial };
}

export function resolveThemeTokens(theme: Theme): ThemeTokens {
  return mergeThemeTokens(theme.tokens);
}

const ALIASES: Record<string, string> = {
  "radius-sm": "radius-button",
  "radius-md": "radius-card",
};

export function applyTheme(theme: Theme): void {
  const tokens = resolveThemeTokens(theme);
  const root = document.documentElement;

  root.classList.add("theme-transition");

  for (const [key, value] of Object.entries(tokens)) {
    if (value !== undefined) {
      root.style.setProperty(`--${key}`, value);
    }
  }

  root.style.setProperty("--radius-sm", tokens["radius-button"]);
  root.style.setProperty("--radius-md", tokens["radius-card"]);

  for (const [alias, source] of Object.entries(ALIASES)) {
    const value = tokens[source as keyof ThemeTokens];
    if (value) {
      root.style.setProperty(`--${alias}`, value);
    }
  }

  window.setTimeout(() => {
    root.classList.remove("theme-transition");
  }, 250);
}

export function findThemeByName(themes: Theme[], name: string): Theme | undefined {
  return themes.find((t) => t.name === name);
}

export function resolveActiveThemeId(
  themes: Theme[],
  activeThemeId: string,
): string {
  if (findThemeByName(themes, activeThemeId) !== undefined) {
    return activeThemeId;
  }
  if (findThemeByName(themes, DEFAULT_THEME_ID) !== undefined) {
    return DEFAULT_THEME_ID;
  }
  return themes[0]?.name ?? DEFAULT_THEME_ID;
}

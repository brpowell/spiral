import type { Theme, ThemeTokens } from "../types/theme";

export const DEFAULT_THEME_ID = "spiral.core.theme.obsidian";

/** Full token set used for merge fallbacks (Obsidian). */
export const OBSIDIAN_DEFAULT_TOKENS: ThemeTokens = {
  "color-bg": "#0e0e10",
  "color-surface": "#1a1a1e",
  "color-surface-raised": "#242428",
  "color-text-primary": "#f0f0f0",
  "color-text-secondary": "#888899",
  "color-text-muted": "#6a6a7a",
  "color-accent": "#7b8cde",
  "color-accent-muted": "#3a4170",
  "color-accent-text": "#ffffff",
  "color-border": "#2a2a32",
  "color-danger": "#e06c75",
  "color-danger-bg": "#2a1518",
  "color-interactive": "#7b8cde",
  "color-interactive-selected-text": "#7b8cde",
  "color-alert-info": "#9aa8e8",
  "color-alert-info-bg": "#1a1f35",
  "color-alert-info-border": "#3a4570",
  "color-alert-success": "#7fd492",
  "color-alert-success-bg": "#152418",
  "color-alert-success-border": "#2a5c38",
  "color-alert-warning": "#e8c57b",
  "color-alert-warning-bg": "#2a2418",
  "color-alert-warning-border": "#5c4a2a",
  "color-alert-error": "#e06c75",
  "color-alert-error-bg": "#2a1518",
  "color-alert-error-border": "#5c2a30",
  "radius-card": "10px",
  "radius-button": "6px",
  "radius-input": "6px",
  "font-ui": "'Inter', system-ui, -apple-system, sans-serif",
};

export function mergeThemeTokens(partial: ThemeTokens): ThemeTokens {
  return { ...OBSIDIAN_DEFAULT_TOKENS, ...partial };
}

export function resolveThemeTokens(theme: Theme): ThemeTokens {
  return mergeThemeTokens(theme.tokens);
}

export function applyTheme(
  theme: Theme,
  options?: { transition?: boolean },
): void {
  const tokens = resolveThemeTokens(theme);
  const root = document.documentElement;
  const withTransition = options?.transition !== false;

  if (withTransition) {
    root.classList.add("theme-transition");
  }

  for (const [key, value] of Object.entries(tokens)) {
    if (value !== undefined) {
      root.style.setProperty(`--${key}`, value);
    }
  }

  if (withTransition) {
    window.setTimeout(() => {
      root.classList.remove("theme-transition");
    }, 250);
  }
}

export function findThemeById(
  themes: Theme[],
  id: string,
): Theme | undefined {
  return themes.find((t) => t.id === id);
}

/** Resolve a stored active-theme id, or fall back to the default / first theme. */
export function resolveActiveThemeId(
  themes: Theme[],
  activeThemeId: string,
): string {
  if (findThemeById(themes, activeThemeId) !== undefined) {
    return activeThemeId;
  }
  if (findThemeById(themes, DEFAULT_THEME_ID) !== undefined) {
    return DEFAULT_THEME_ID;
  }
  return themes[0]?.id ?? DEFAULT_THEME_ID;
}

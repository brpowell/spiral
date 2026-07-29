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

/** Color tokens that interpolate via `CSS.registerProperty`. */
const THEME_COLOR_TOKEN_KEYS = Object.keys(OBSIDIAN_DEFAULT_TOKENS).filter((key) =>
  key.startsWith("color-"),
);

const THEME_TRANSITION_MS = 200;
const THEME_TRANSITION_STYLE_ID = "spiral-theme-transition";

let themeColorPropertiesRegistered = false;
let themeTransitionTimer: ReturnType<typeof setTimeout> | undefined;

function ensureThemeColorPropertiesRegistered(): void {
  if (themeColorPropertiesRegistered) return;
  themeColorPropertiesRegistered = true;

  if (typeof CSS === "undefined" || typeof CSS.registerProperty !== "function") {
    return;
  }

  for (const key of THEME_COLOR_TOKEN_KEYS) {
    const initialValue = OBSIDIAN_DEFAULT_TOKENS[key];
    if (!initialValue) continue;
    try {
      CSS.registerProperty({
        name: `--${key}`,
        syntax: "<color>",
        inherits: true,
        initialValue,
      });
    } catch {
      // Already registered (HMR / second window bootstrap).
    }
  }
}

function ensureThemeTransitionStyle(): void {
  if (document.getElementById(THEME_TRANSITION_STYLE_ID)) return;

  const transitions = THEME_COLOR_TOKEN_KEYS.map(
    (key) => `--${key} ${THEME_TRANSITION_MS}ms ease`,
  ).join(",\n    ");

  const style = document.createElement("style");
  style.id = THEME_TRANSITION_STYLE_ID;
  // Transition only registered custom properties on <html> — descendants pick
  // up interpolated vars without per-element transition thrash.
  style.textContent = `html.theme-transition {\n  transition:\n    ${transitions};\n}`;
  document.head.appendChild(style);
}

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
  ensureThemeColorPropertiesRegistered();
  ensureThemeTransitionStyle();

  const tokens = resolveThemeTokens(theme);
  const root = document.documentElement;
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const withTransition = options?.transition === true && !prefersReducedMotion;

  if (themeTransitionTimer !== undefined) {
    clearTimeout(themeTransitionTimer);
    themeTransitionTimer = undefined;
  }

  if (withTransition) {
    root.classList.add("theme-transition");
  } else {
    root.classList.remove("theme-transition");
  }

  for (const [key, value] of Object.entries(tokens)) {
    if (value !== undefined) {
      root.style.setProperty(`--${key}`, value);
    }
  }

  if (withTransition) {
    themeTransitionTimer = setTimeout(() => {
      root.classList.remove("theme-transition");
      themeTransitionTimer = undefined;
    }, THEME_TRANSITION_MS + 50);
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

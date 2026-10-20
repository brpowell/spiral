import { setTheme as setAppTheme } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  DERIVED_THEME_TOKEN_KEYS,
  type Theme,
  type ThemeTokens,
} from "../types/theme";
import { DEFAULT_FONT_ID, resolveFontStack } from "./fonts";

export const DEFAULT_THEME_ID = "spiral.theme.obsidian";

/** Authorable token set used for merge fallbacks (Obsidian). */
export const OBSIDIAN_DEFAULT_TOKENS: ThemeTokens = {
  "color-bg": "#0e0e10",
  "color-text-primary": "#f0f0f0",
  "color-accent": "#7b8cde",
  "color-danger": "#e06c75",
  "color-alert-info": "#9aa8e8",
  "color-alert-success": "#7fd492",
  "color-alert-warning": "#e8c57b",
  "font-ui": DEFAULT_FONT_ID,
};

/** Color tokens that interpolate via `CSS.registerProperty`. */
const THEME_COLOR_TOKEN_KEYS = Object.keys(OBSIDIAN_DEFAULT_TOKENS).filter(
  (key) => key.startsWith("color-"),
);

const THEME_TRANSITION_MS = 200;
const THEME_TRANSITION_STYLE_ID = "spiral-theme-transition";

let themeColorPropertiesRegistered = false;
let themeTransitionTimer: ReturnType<typeof setTimeout> | undefined;

function ensureThemeColorPropertiesRegistered(): void {
  if (themeColorPropertiesRegistered) return;
  themeColorPropertiesRegistered = true;

  if (
    typeof CSS === "undefined" ||
    typeof CSS.registerProperty !== "function"
  ) {
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

/** Drop retired keys so CSS-derived washes are not overridden by theme.json. */
export function stripDerivedThemeTokens(tokens: ThemeTokens): ThemeTokens {
  const next: ThemeTokens = { ...tokens };
  for (const key of DERIVED_THEME_TOKEN_KEYS) {
    delete next[key];
  }
  return next;
}

export function mergeThemeTokens(partial: ThemeTokens): ThemeTokens {
  return stripDerivedThemeTokens({ ...OBSIDIAN_DEFAULT_TOKENS, ...partial });
}

/**
 * Defaults filled in and `font-ui` expanded from its catalog id to a CSS stack,
 * so everything downstream (apply, previews, visualizers) sees a usable value.
 */
export function resolveThemeTokens(theme: Pick<Theme, "tokens">): ThemeTokens {
  const tokens = mergeThemeTokens(theme.tokens);
  tokens["font-ui"] = resolveFontStack(tokens["font-ui"]);
  return tokens;
}

/** sRGB relative luminance of a `#rrggbb` color, or null if unparsable. */
function hexRelativeLuminance(hex: string): number | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const n = Number.parseInt(match[1]!, 16);
  const channel = (shift: number) => {
    const c = ((n >> shift) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

/** Form `color-scheme` and native dialogs from the page background. */
export function windowAppearanceForBackground(
  bg: string | undefined,
): "light" | "dark" {
  const luminance = bg ? hexRelativeLuminance(bg) : null;
  if (luminance == null) return "dark";
  return luminance > 0.45 ? "light" : "dark";
}

/** Light/dark for form controls, native dialogs, and highlighted-label contrast. */
function syncNativeWindowAppearance(appearance: "light" | "dark"): void {
  document.documentElement.dataset.appearance = appearance;
  document.documentElement.style.colorScheme = appearance;
  void setAppTheme(appearance).catch(() => {
    // Browser / tests / hosts without the permission.
  });
  try {
    void getCurrentWindow()
      .setTheme(appearance)
      .catch(() => {
        // Optional per-window path.
      });
  } catch {
    // Non-Tauri hosts.
  }
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

  for (const key of DERIVED_THEME_TOKEN_KEYS) {
    root.style.removeProperty(`--${key}`);
  }

  for (const [key, value] of Object.entries(tokens)) {
    if (value !== undefined) {
      root.style.setProperty(`--${key}`, value);
    }
  }

  syncNativeWindowAppearance(windowAppearanceForBackground(tokens["color-bg"]));

  if (withTransition) {
    themeTransitionTimer = setTimeout(() => {
      root.classList.remove("theme-transition");
      themeTransitionTimer = undefined;
    }, THEME_TRANSITION_MS + 50);
  }
}

export function findThemeById(themes: Theme[], id: string): Theme | undefined {
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

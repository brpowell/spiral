import type { PackZone } from "./pack";

/** Token map may be incomplete on workshop drafts; use `resolveThemeTokens` before apply/preview. */
export interface ThemeTokens {
  "color-bg"?: string;
  "color-surface"?: string;
  "color-surface-raised"?: string;
  "color-text-primary"?: string;
  "color-text-secondary"?: string;
  /** Dimmer than secondary; skin chrome etc. */
  "color-text-muted"?: string;
  "color-accent"?: string;
  "color-accent-muted"?: string;
  /** Foreground on solid accent fills (primary buttons). */
  "color-accent-text"?: string;
  "color-border"?: string;
  "color-danger"?: string;
  "color-danger-bg"?: string;
  /**
   * Solid base for interactive washes (sidebar, lists, tabs, menus).
   * CSS mixes this at fixed strengths for hover/selected — do not store color-mix.
   */
  "color-interactive"?: string;
  /** Text on selected interactive surfaces (e.g. sidebar active). Falls back to accent. */
  "color-interactive-selected-text"?: string;
  "radius-card"?: string;
  "radius-button"?: string;
  /** Inputs, chips, menus, badges — drives `--radius-sm`. */
  "radius-input"?: string;
  "font-ui"?: string;
  [key: string]: string | undefined;
}

export interface Theme {
  /** Effective id: `authorId.packId.type.contributionId`. */
  id: string;
  /** Human-readable display label. */
  name: string;
  /** Freeform credit for the contribution's creator. */
  author: string;
  description: string;
  tokens: ThemeTokens;
  /** Pack directory id (kebab slug). */
  packId: string;
  /** Structured pack maintainer/distributor slug. */
  authorId: string;
  packName: string;
  packVersion: string;
  zone: PackZone;
  /** Authoring drafts (workshop or linked). */
  mutable: boolean;
}

/** Required token keys for applying a theme (theme-v1 schema). */
export const REQUIRED_THEME_TOKEN_KEYS = [
  "color-bg",
  "color-surface",
  "color-text-primary",
  "color-text-secondary",
  "color-accent",
  "color-accent-muted",
  "color-border",
  "color-danger",
  "radius-card",
  "radius-button",
  "font-ui",
] as const;

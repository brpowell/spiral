import type { PackZone } from "./pack";

/** Token map may be incomplete on workshop drafts; use `resolveThemeTokens` before apply/preview. */
export interface ThemeTokens {
  "color-bg"?: string;
  "color-text-primary"?: string;
  "color-accent"?: string;
  "color-danger"?: string;
  "color-alert-info"?: string;
  "color-alert-success"?: string;
  "color-alert-warning"?: string;
  /** Kept for the pack schema. Apply uses the Sprig radii in `theme.css`. */
  "radius-card"?: string;
  "radius-button"?: string;
  "radius-input"?: string;
  "font-ui"?: string;
  [key: string]: string | undefined;
}

export interface Theme {
  /** Effective id: `publisherId.theme.id`. */
  id: string;
  /** Human-readable display label. */
  name: string;
  /** Freeform credit for the contribution's creator. */
  author: string;
  description: string;
  tokens: ThemeTokens;
  /** Structured maintainer/distributor slug. */
  publisherId: string;
  /** Semver content version of this item build. */
  version: string;
  zone: PackZone;
  /** Authoring drafts (workshop or linked). */
  mutable: boolean;
}

/** Required token keys for applying a theme (theme-v1 schema). */
export const REQUIRED_THEME_TOKEN_KEYS = [
  "color-bg",
  "color-text-primary",
  "color-accent",
  "color-danger",
  "radius-card",
  "radius-button",
  "font-ui",
] as const;

/**
 * Formerly authorable tokens now derived in CSS. Stripped on merge/apply so
 * workshop or older theme.json values cannot override the washes.
 */
export const DERIVED_THEME_TOKEN_KEYS = [
  "color-surface",
  "color-surface-raised",
  "color-border",
  "color-text-secondary",
  "color-text-muted",
  "color-accent-muted",
  "color-accent-text",
  "color-interactive",
  "color-interactive-selected-text",
  "color-danger-bg",
  "color-alert-error",
  "color-alert-error-bg",
  "color-alert-error-border",
  "color-alert-info-bg",
  "color-alert-info-border",
  "color-alert-success-bg",
  "color-alert-success-border",
  "color-alert-warning-bg",
  "color-alert-warning-border",
] as const;

import type { Theme, ThemeTokens } from "../types/theme";
import { REQUIRED_THEME_TOKEN_KEYS } from "../types/theme";

export type ThemeValidationIssue = {
  field: string;
  message: string;
};

/** Lenient draft save: structural fields may be empty; tokens may be incomplete. */
export function validateThemeForSave(theme: Theme): ThemeValidationIssue[] {
  const issues: ThemeValidationIssue[] = [];
  if (!theme.id.trim()) {
    issues.push({ field: "id", message: "Theme id is required." });
  }
  if (!theme.packId.trim()) {
    issues.push({ field: "packId", message: "Pack id is required." });
  }
  if (!theme.mutable) {
    issues.push({
      field: "mutable",
      message: "Only mutable drafts can be saved.",
    });
  }
  return issues;
}

function tokenValue(tokens: ThemeTokens, key: string): string | undefined {
  const value = tokens[key];
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Strict apply: all required tokens present and non-empty; name required. */
export function validateThemeForApply(theme: Theme): ThemeValidationIssue[] {
  const issues: ThemeValidationIssue[] = [];

  if (!theme.name.trim()) {
    issues.push({ field: "name", message: "Name is required to apply a theme." });
  }

  for (const key of REQUIRED_THEME_TOKEN_KEYS) {
    if (tokenValue(theme.tokens, key) == null) {
      issues.push({
        field: `tokens.${key}`,
        message: `Token "${key}" is required to apply a theme.`,
      });
    }
  }

  return issues;
}

export function formatThemeValidationError(
  issues: ThemeValidationIssue[],
): string {
  if (issues.length === 0) return "";
  if (issues.length === 1) return issues[0].message;
  return `${issues[0].message} (+${issues.length - 1} more)`;
}

export function isThemeApplicable(theme: Theme): boolean {
  return validateThemeForApply(theme).length === 0;
}

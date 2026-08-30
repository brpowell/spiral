import { i18n, t } from "./i18n";
import type { TranslationKey } from "./i18nKeys";

const LICENSE_CODE_RE =
  /^(license\.(?:installed|installing)\.[a-z_]+|license\.generic)$/;

function rawErrorText(err: unknown): string {
  if (typeof err === "string") return err.trim();
  if (err instanceof Error) return err.message.trim();
  return "";
}

/** Parse a Rust user-error code (`license.installing.not_found`). */
export function parseUserErrorCode(err: unknown): string | null {
  const raw = rawErrorText(err);
  if (!raw) return null;
  return LICENSE_CODE_RE.test(raw) ? raw : null;
}

/**
 * Map a Rust boundary code to catalog copy. Returns null when the payload is
 * not a known code — callers should use a generic fallback, not the raw string.
 */
export function translateUserError(err: unknown): string | null {
  const code = parseUserErrorCode(err);
  if (!code) return null;
  const key = `errors:${code}`;
  return i18n.exists(key)
    ? t(key as TranslationKey)
    : t("errors:license.generic");
}

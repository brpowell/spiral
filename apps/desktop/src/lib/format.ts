import { getIntlLocale } from "./appLocale";

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Compact natural duration for totals (e.g. "4h 15m", "42m", "1h"). */
export function formatDurationNatural(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0m";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) return `${minutes}m`;
  return `${total}s`;
}

export function formatRemainingTime(
  elapsedSeconds: number,
  totalSeconds: number,
): string {
  const remaining = Math.max(0, totalSeconds - elapsedSeconds);
  return `-${formatTime(remaining)}`;
}

export function formatDateAdded(
  iso: string,
  locale: string = getIntlLocale(),
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

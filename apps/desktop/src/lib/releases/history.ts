import { getIntlLocale } from "../appLocale";
import type { AvailableUpdateInfo } from "../updater";

export const RELEASES_HISTORY_URL =
  "https://www.spiralpowered.com/api/releases";

/** Vite `envPrefix` exposes `SPIRAL_*` from repo-root `.env`. */
export function releasesHistoryUrl(
  override: string | undefined = import.meta.env.SPIRAL_RELEASES_URL,
): string {
  const trimmed = override?.trim();
  return trimmed ? trimmed : RELEASES_HISTORY_URL;
}

export type ReleaseNotesItem = {
  version: string;
  notes: string;
  pub_date: string;
};

export class ReleaseHistoryError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ReleaseHistoryError";
    this.status = status;
  }
}

export function normalizeReleaseVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

function isReleaseNotesItem(value: unknown): value is ReleaseNotesItem {
  if (value == null || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.version === "string" &&
    typeof item.notes === "string" &&
    typeof item.pub_date === "string"
  );
}

function fallbackReleaseFromUpdate(
  update: Pick<AvailableUpdateInfo, "version" | "body" | "date">,
): ReleaseNotesItem {
  return {
    version: normalizeReleaseVersion(update.version),
    notes: update.body ?? "",
    pub_date: update.date ?? "",
  };
}

/** One UTC day before `iso`, or one day before now when the source is missing. */
function dayBeforeIso(iso: string | undefined): string {
  const parsed = iso?.trim() ? new Date(iso) : new Date();
  const source = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  source.setUTCDate(source.getUTCDate() - 1);
  return source.toISOString();
}

/**
 * History from the site, plus the pending updater body if that version is not
 * in the list yet (fetch still in flight, failed, or lagging publish).
 * Pass `installedVersion` to keep the current build visible when history is empty.
 */
export function resolveWhatsNewRows(options: {
  history: ReleaseNotesItem[];
  availableUpdate: Pick<
    AvailableUpdateInfo,
    "version" | "body" | "date"
  > | null;
  installedVersion?: string | null;
}): ReleaseNotesItem[] {
  const rows = options.history.map((item) => ({
    ...item,
    version: normalizeReleaseVersion(item.version),
  }));
  if (options.availableUpdate) {
    const fallback = fallbackReleaseFromUpdate(options.availableUpdate);
    if (!rows.some((row) => row.version === fallback.version)) {
      rows.unshift(fallback);
    }
  }

  const installed = options.installedVersion
    ? normalizeReleaseVersion(options.installedVersion)
    : null;
  if (installed && !rows.some((row) => row.version === installed)) {
    rows.push({
      version: installed,
      notes: "",
      pub_date: dayBeforeIso(options.availableUpdate?.date),
    });
  }
  return rows;
}

export function pickSelectedVersion(options: {
  rows: ReleaseNotesItem[];
  focusVersion: string | null;
}): string | null {
  if (options.rows.length === 0) return null;
  const focus = options.focusVersion
    ? normalizeReleaseVersion(options.focusVersion)
    : null;
  if (focus) {
    const match = options.rows.find((row) => row.version === focus);
    if (match) return match.version;
  }
  return options.rows[0].version;
}

/** Latest published row, and only when a pending update matches that version. */
export function canShowUpdateAction(options: {
  selectedVersion: string | null;
  rows: ReleaseNotesItem[];
  availableUpdate: Pick<AvailableUpdateInfo, "version"> | null;
}): boolean {
  if (!options.selectedVersion || !options.availableUpdate) return false;
  if (options.rows.length === 0) return false;
  const selected = normalizeReleaseVersion(options.selectedVersion);
  const latest = options.rows[0].version;
  const pending = normalizeReleaseVersion(options.availableUpdate.version);
  return selected === latest && selected === pending;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Relative date within a week, otherwise a short locale date. */
export function formatReleaseDate(iso: string, nowMs = Date.now()): string {
  if (!iso.trim()) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diffDays = Math.round((date.getTime() - nowMs) / DAY_MS);
  if (Math.abs(diffDays) < 7) {
    return new Intl.RelativeTimeFormat(getIntlLocale(), {
      numeric: "auto",
    }).format(diffDays, "day");
  }
  return date.toLocaleDateString(getIntlLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export async function fetchReleaseHistory(options?: {
  limit?: number;
  signal?: AbortSignal;
}): Promise<ReleaseNotesItem[]> {
  const url = new URL(releasesHistoryUrl());
  if (options?.limit != null) {
    url.searchParams.set("limit", String(options.limit));
  }

  const response = await fetch(url, { signal: options?.signal });
  if (!response.ok) {
    throw new ReleaseHistoryError(
      "Release notes are unavailable",
      response.status,
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ReleaseHistoryError("Release notes response was invalid");
  }

  const releases =
    data != null && typeof data === "object"
      ? (data as { releases?: unknown }).releases
      : undefined;
  if (!Array.isArray(releases) || !releases.every(isReleaseNotesItem)) {
    throw new ReleaseHistoryError("Release notes response was invalid");
  }

  return releases.map((item) => ({
    version: normalizeReleaseVersion(item.version),
    notes: item.notes,
    pub_date: item.pub_date,
  }));
}

export type ParsedReleaseNotes = {
  /** Markdown shown up front, without a repeated version heading. */
  summary: string;
  /** Markdown inside the trailing `<details>` block, when present. */
  details: string | null;
};

/** The pane already titles itself with the version, so drop a leading `## 0.4.0` style heading. */
export function stripLeadingVersionHeading(
  notes: string,
  version: string,
): string {
  const normalized = normalizeReleaseVersion(version);
  const lines = notes.replace(/\r\n/g, "\n").split("\n");
  const first = lines.findIndex((line) => line.trim() !== "");
  if (first < 0) return "";
  const match = lines[first].match(/^#{1,6}[ \t]+(.+?)[ \t]*$/);
  if (match && match[1].includes(normalized)) {
    return lines
      .slice(first + 1)
      .join("\n")
      .trim();
  }
  return notes.trim();
}

const DETAILS_RE =
  /<details[^>]*>\s*<summary>[\s\S]*?<\/summary>([\s\S]*?)<\/details>/i;

/**
 * Split a release body into the up-front summary and its collapsed line items.
 * Raw HTML is never passed to the markdown renderer: the `<details>` block is
 * pulled out here and rendered by the modal.
 */
export function parseReleaseNotes(
  notes: string,
  version: string,
): ParsedReleaseNotes {
  const cleaned = stripLeadingVersionHeading(
    notes.replace(/<!--[\s\S]*?-->/g, ""),
    version,
  );
  const match = cleaned.match(DETAILS_RE);
  if (!match || match.index === undefined) {
    return { summary: cleaned, details: null };
  }
  const summary = `${cleaned.slice(0, match.index)}${cleaned.slice(
    match.index + match[0].length,
  )}`.trim();
  const details = match[1].trim();
  return { summary, details: details.length > 0 ? details : null };
}

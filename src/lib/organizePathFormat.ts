import type { Track } from "../types/track";

export const DEFAULT_ORGANIZE_PATH_FORMAT =
  "{albumArtist}/{album}/{trackNumber:02} - {title}.{ext}";

export interface OrganizePathSample {
  title: string;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  trackNumber: number | null;
  discNumber: number | null;
  year: number | null;
  genre: string | null;
  extension: string;
}

export const GENERIC_ORGANIZE_PATH_SAMPLE: OrganizePathSample = {
  title: "Example Song",
  artist: "Example Artist",
  album: "Example Album",
  albumArtist: "Example Artist",
  trackNumber: 3,
  discNumber: 1,
  year: 2024,
  genre: "Rock",
  extension: "mp3",
};

export function trackToOrganizePathSample(track: Track): OrganizePathSample {
  const extension =
    track.filePath.split(".").pop()?.toLowerCase() ?? "mp3";
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist,
    trackNumber: track.trackNumber,
    discNumber: track.discNumber,
    year: track.year,
    genre: track.genre,
    extension,
  };
}

const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

function isWindowsReservedName(name: string): boolean {
  const stem = name.split(".")[0]?.toUpperCase() ?? "";
  return WINDOWS_RESERVED_NAMES.has(stem);
}

function isForbiddenPathSegment(name: string): boolean {
  return name === "." || name === "..";
}

export function sanitizeFilename(name: string): string {
  let out = "";
  for (const ch of name) {
    if (ch < " " || ch === "\u007f") continue;
    if ("/\\:<>\"|?*".includes(ch)) continue;
    out += ch;
  }
  const trimmed = out.split(/\s+/).filter(Boolean).join(" ");
  return trimmed || "Unknown";
}

function sanitizeExtension(ext: string): string {
  const filtered = ext.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return filtered || "mp3";
}

function parsePlaceholder(rest: string): [key: string, pad: number | null, end: number] | null {
  const close = rest.indexOf("}");
  if (close === -1) return null;
  const inner = rest.slice(1, close);
  const colon = inner.indexOf(":");
  const key = (colon === -1 ? inner : inner.slice(0, colon)).trim();
  const padRaw = colon === -1 ? "" : inner.slice(colon + 1).trim();
  const pad = padRaw ? Number.parseInt(padRaw, 10) : null;
  if (!key || (padRaw && !Number.isFinite(pad))) return null;
  return [key, pad, close + 1];
}

function formatOptionalNumber(value: number | null, pad: number | null): string {
  if (value == null) return "";
  if (pad != null && pad > 0) {
    return String(value).padStart(pad, "0");
  }
  return String(value);
}

function placeholderValue(
  key: string,
  pad: number | null,
  sample: OrganizePathSample,
): string {
  switch (key) {
    case "title":
      return sanitizeFilename(sample.title);
    case "artist":
      return sanitizeFilename(sample.artist ?? "Unknown Artist");
    case "album":
      return sanitizeFilename(sample.album ?? "Unknown Album");
    case "albumArtist":
      return sanitizeFilename(
        sample.albumArtist ?? sample.artist ?? "Unknown Artist",
      );
    case "ext":
      return sanitizeExtension(sample.extension);
    case "genre":
      return sample.genre ? sanitizeFilename(sample.genre) : "";
    case "year":
      return sample.year != null ? String(sample.year) : "";
    case "trackNumber":
      return formatOptionalNumber(sample.trackNumber, pad);
    case "discNumber":
      return formatOptionalNumber(sample.discNumber, pad);
    default:
      return "";
  }
}

function cleanFormattedStem(stem: string): string {
  let s = stem.trim();
  while (s.startsWith(" - ")) {
    s = s.slice(3).trimStart();
  }
  while (s.startsWith("- ")) {
    s = s.slice(2).trimStart();
  }
  while (s.endsWith(" -") || s.endsWith(" - ")) {
    s = s.replace(/[\s-]+$/, "");
  }
  return sanitizeFilename(s);
}

function finalizePathSegment(segment: string): string {
  const trimmed = segment.trim();
  if (!trimmed || isForbiddenPathSegment(trimmed)) return "";

  const cleaned = cleanFormattedStem(trimmed);
  if (!cleaned || isForbiddenPathSegment(cleaned)) return "";

  const dot = cleaned.lastIndexOf(".");
  if (dot > 0) {
    const stem = cleaned.slice(0, dot);
    const ext = cleaned.slice(dot + 1);
    if (ext && isWindowsReservedName(stem)) return `${stem}_.${ext}`;
  } else if (isWindowsReservedName(cleaned)) {
    return `${cleaned}_`;
  }

  return cleaned;
}

function expandTemplate(
  template: string,
  sample: OrganizePathSample,
): string {
  let out = "";
  let i = 0;
  while (i < template.length) {
    if (template[i] === "{") {
      const parsed = parsePlaceholder(template.slice(i));
      if (parsed) {
        const [key, pad, end] = parsed;
        out += placeholderValue(key, pad, sample);
        i += end;
        continue;
      }
    }
    out += template[i];
    i += 1;
  }
  return out;
}

/** Relative path under the media folder. Mirrors backend `format_organize_relative_path`. */
export function formatOrganizeRelativePath(
  pathFormat: string,
  sample: OrganizePathSample,
): string {
  const template = pathFormat.trim() || DEFAULT_ORGANIZE_PATH_FORMAT;
  return expandTemplate(template, sample)
    .split(/[/\\]/)
    .filter(Boolean)
    .map(finalizePathSegment)
    .filter(Boolean)
    .join("/");
}

export function isDefaultOrganizePathFormat(format: string): boolean {
  return format.trim() === DEFAULT_ORGANIZE_PATH_FORMAT;
}

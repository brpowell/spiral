import { invoke } from "@tauri-apps/api/core";
import type { LibrarySettings, LibrarySettingsPatch } from "../types/library";
import { parseRepeatMode } from "./playbackSession";
import type { PlaybackSession } from "../types/playbackSession";
import type { Theme } from "../types/theme";
import type { CoverArtCandidate } from "../types/coverArt";
import type { TrackMetadataUpdate } from "../types/metadata";
import type { Track, TrackInput } from "../types/track";

function normalizeCoverArtCandidate(
  raw: Record<string, unknown>,
): CoverArtCandidate {
  return {
    url: raw.url as string,
    thumbnailUrl:
      (raw.thumbnailUrl as string | null) ??
      (raw.thumbnail_url as string | null) ??
      null,
    fileSize:
      (raw.fileSize as number | null) ??
      (raw.file_size as number | null) ??
      null,
    width: (raw.width as number | null) ?? null,
    height: (raw.height as number | null) ?? null,
    canonicalRank:
      (raw.canonicalRank as number) ?? (raw.canonical_rank as number) ?? 0,
  };
}

/** Normalize track JSON in case serde casing differs at the IPC boundary. */
function normalizeTrack(raw: Record<string, unknown>): Track {
  return {
    id: raw.id as number,
    title: raw.title as string,
    artist: (raw.artist as string | null) ?? null,
    album: (raw.album as string | null) ?? null,
    albumArtist:
      (raw.albumArtist as string | null) ??
      (raw.album_artist as string | null) ??
      null,
    trackNumber:
      (raw.trackNumber as number | null) ??
      (raw.track_number as number | null) ??
      null,
    discNumber:
      (raw.discNumber as number | null) ??
      (raw.disc_number as number | null) ??
      null,
    year: (raw.year as number | null) ?? null,
    genre: (raw.genre as string | null) ?? null,
    durationSeconds:
      (raw.durationSeconds as number | null) ??
      (raw.duration_seconds as number | null) ??
      null,
    filePath: (raw.filePath ?? raw.file_path) as string,
    artPath:
      (raw.artPath as string | null) ?? (raw.art_path as string | null) ?? null,
    dateAdded: (raw.dateAdded ?? raw.date_added) as string,
    playCount:
      (raw.playCount as number | undefined) ??
      (raw.play_count as number | undefined) ??
      0,
  };
}

export async function recordTrackPlay(trackId: number): Promise<number> {
  return invoke<number>("record_track_play", { trackId });
}

export async function pickAudioFiles(): Promise<string[]> {
  return invoke<string[]>("pick_audio_files");
}

export async function pickLibraryPaths(): Promise<string[]> {
  return invoke<string[]>("pick_library_paths");
}

export async function scanFolder(folderPath: string): Promise<string[]> {
  return invoke<string[]>("scan_folder", { folderPath });
}

export async function saveTrack(track: TrackInput): Promise<number> {
  return invoke<number>("save_track", { track });
}

export async function removeTrack(
  trackId: number,
  deleteFromDisk: boolean,
): Promise<void> {
  return invoke<void>("remove_track", { trackId, deleteFromDisk });
}

export async function getLibrary(): Promise<Track[]> {
  const rows = await invoke<Record<string, unknown>[]>("get_library");
  return rows.map(normalizeTrack);
}

export async function pickImageFile(): Promise<string | null> {
  return invoke<string | null>("pick_image_file");
}

export async function cacheArtFromFile(
  sourcePath: string,
  filePath: string,
): Promise<string> {
  return invoke<string>("cache_art_from_file", { sourcePath, filePath });
}

export async function cacheArtFromBytes(
  bytes: number[],
  filePath: string,
  format: string,
): Promise<string> {
  return invoke<string>("cache_art_from_bytes", { bytes, filePath, format });
}

export async function cacheArtFromUrl(
  url: string,
  filePath: string,
): Promise<string> {
  return invoke<string>("cache_art_from_url", { url, filePath });
}

export async function fetchCoverArt(
  artist: string,
  album: string,
): Promise<CoverArtCandidate[]> {
  const rows = await invoke<Record<string, unknown>[]>("fetch_cover_art", {
    artist,
    album,
  });
  return rows.map(normalizeCoverArtCandidate);
}

export async function getBuiltinThemes(): Promise<Theme[]> {
  return invoke<Theme[]>("get_builtin_themes");
}

export async function loadUserThemes(): Promise<Theme[]> {
  return invoke<Theme[]>("load_user_themes");
}

export async function getActiveThemeId(): Promise<string> {
  return invoke<string>("get_active_theme_id");
}

export async function saveActiveThemeId(themeName: string): Promise<void> {
  return invoke<void>("save_active_theme_id", { themeName });
}

export async function openThemesFolder(): Promise<void> {
  return invoke<void>("open_themes_folder");
}

export async function importUserTheme(): Promise<Theme | null> {
  return invoke<Theme | null>("import_user_theme");
}

export async function writeTrackMetadata(
  trackId: number,
  filePath: string,
  metadata: TrackMetadataUpdate,
): Promise<Track> {
  const raw = await invoke<Record<string, unknown>>("write_track_metadata", {
    trackId,
    filePath,
    metadata,
  });
  return normalizeTrack(raw);
}

export async function pickFolder(): Promise<string[]> {
  return invoke<string[]>("pick_folder");
}

export async function getLibrarySettings(): Promise<LibrarySettings> {
  return invoke<LibrarySettings>("get_library_settings");
}

export async function saveLibrarySettings(
  patch: LibrarySettingsPatch,
): Promise<LibrarySettings> {
  return invoke<LibrarySettings>("save_library_settings", { library: patch });
}

export async function prepareImportFile(
  sourcePath: string,
  mode: "copy" | "reference",
  autoOrganize: boolean,
  mediaFolder: string,
): Promise<string> {
  return invoke<string>("prepare_import_file", {
    sourcePath,
    mode,
    autoOrganize,
    mediaFolder,
  });
}

export async function pickDatabaseFolder(): Promise<string | null> {
  return invoke<string | null>("pick_database_folder");
}

function normalizePlaybackSession(
  raw: Record<string, unknown> | null | undefined,
): PlaybackSession | null {
  if (!raw) return null;
  return {
    playContextIds: (raw.playContextIds ?? raw.play_context_ids ?? []) as number[],
    manualQueueIds: (raw.manualQueueIds ?? raw.manual_queue_ids ?? []) as number[],
    currentTrackId:
      (raw.currentTrackId as number | null | undefined) ??
      (raw.current_track_id as number | null | undefined) ??
      null,
    positionSeconds:
      (raw.positionSeconds as number | undefined) ??
      (raw.position_seconds as number | undefined) ??
      0,
    shuffle: Boolean(raw.shuffle),
    repeatMode: parseRepeatMode(raw.repeatMode ?? raw.repeat_mode),
  };
}

export async function getPlaybackSession(): Promise<PlaybackSession | null> {
  const raw = await invoke<Record<string, unknown> | null>(
    "get_playback_session",
  );
  return normalizePlaybackSession(raw);
}

export async function savePlaybackSession(
  session: PlaybackSession,
): Promise<void> {
  await invoke<void>("save_playback_session", { session });
}

export interface TrackListPreferencesPayload {
  columnWidths: Partial<
    Record<
      | "index"
      | "trackNumber"
      | "title"
      | "artist"
      | "album"
      | "albumArtist"
      | "duration"
      | "year"
      | "genre"
      | "discNumber",
      number
    >
  >;
  hiddenColumns: string[];
}

function normalizeTrackListPreferences(
  raw: Record<string, unknown>,
): TrackListPreferencesPayload {
  const columnWidths: TrackListPreferencesPayload["columnWidths"] = {};
  const widthsRaw =
    (raw.columnWidths as Record<string, unknown> | undefined) ??
    (raw.column_widths as Record<string, unknown> | undefined);
  if (widthsRaw) {
    for (const [key, value] of Object.entries(widthsRaw)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        columnWidths[key as keyof typeof columnWidths] = Math.round(value);
      }
    }
  }

  const hiddenRaw =
    (raw.hiddenColumns as unknown[] | undefined) ??
    (raw.hidden_columns as unknown[] | undefined);
  const hiddenColumns = Array.isArray(hiddenRaw)
    ? hiddenRaw.filter((v): v is string => typeof v === "string")
    : [];

  return { columnWidths, hiddenColumns };
}

export async function getTrackListPreferences(): Promise<TrackListPreferencesPayload> {
  const raw = await invoke<Record<string, unknown>>("get_track_list_preferences");
  return normalizeTrackListPreferences(raw);
}

export async function saveTrackListPreferences(
  preferences: TrackListPreferencesPayload,
): Promise<void> {
  await invoke<void>("save_track_list_preferences", { preferences });
}

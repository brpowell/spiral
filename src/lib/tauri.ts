import { invoke } from "@tauri-apps/api/core";
import type { LibrarySettings, LibrarySettingsPatch } from "../types/library";
import type { Theme } from "../types/theme";
import type { TrackMetadataUpdate } from "../types/metadata";
import type { Track, TrackInput } from "../types/track";

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
  };
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
): Promise<string[]> {
  return invoke<string[]>("fetch_cover_art", { artist, album });
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

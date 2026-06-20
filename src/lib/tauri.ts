import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { LibrarySettings, LibrarySettingsPatch } from "../types/library";
import type { CdDisc, CdDiscCdText, CdDrive, DiscMetadata, DiscMetadataCachePeek, DiscMetadataLookup, DiscTocTrack } from "../types/cd";
import type { TrackMetadataUpdate } from "../types/metadata";
import { parseRepeatMode } from "./playbackSession";
import type { PlaybackSession } from "../types/playbackSession";
import type { Theme } from "../types/theme";
import type { LoadedSkinPack, SkinSummary } from "../types/skin";
import type { LoadedVisualizerPack, VizSummary } from "../types/visualizer";
import type { CoverArtCandidate } from "../types/coverArt";
import type { Playlist } from "../types/playlist";
import type { Track, TrackInput } from "../types/track";
import type { ActivityLogContext } from "../types/activityLog";

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

export async function saveTrack(track: TrackInput): Promise<Track> {
  const row = await invoke<Record<string, unknown>>("save_track", { track });
  return normalizeTrack(row);
}

export async function replaceTrackFromImport(options: {
  trackId: number;
  sourcePath: string;
  mode: "copy" | "reference";
  track: TrackInput;
}): Promise<Track> {
  const row = await invoke<Record<string, unknown>>("replace_track_from_import", {
    trackId: options.trackId,
    sourcePath: options.sourcePath,
    mode: options.mode,
    track: options.track,
  });
  return normalizeTrack(row);
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

function normalizePlaylistImageMode(
  raw: Record<string, unknown>,
): Playlist["imageMode"] {
  const mode = (raw.imageMode ?? raw.image_mode) as string | undefined;
  return mode === "custom" ? "custom" : "generated";
}

function normalizePlaylist(raw: Record<string, unknown>): Playlist {
  return {
    id: raw.id as number,
    title: raw.title as string,
    description:
      (raw.description as string | null | undefined) ?? null,
    dateCreated: (raw.dateCreated ?? raw.date_created) as string,
    lastUsedAt: (raw.lastUsedAt ?? raw.last_used_at) as string,
    trackIds: (raw.trackIds ?? raw.track_ids ?? []) as number[],
    imageMode: normalizePlaylistImageMode(raw),
    customImagePath:
      (raw.customImagePath ?? raw.custom_image_path ?? null) as string | null,
  };
}

export async function getPlaylists(): Promise<Playlist[]> {
  const rows = await invoke<Record<string, unknown>[]>("get_playlists");
  return rows.map(normalizePlaylist);
}

export interface PlaylistImageUpdate {
  imageMode: Playlist["imageMode"];
  customImagePath: string | null;
}

export async function createPlaylist(
  title: string,
  description: string | null,
  image: PlaylistImageUpdate,
): Promise<number> {
  return invoke<number>("create_playlist", {
    title,
    description,
    imageMode: image.imageMode,
    customImagePath: image.customImagePath,
  });
}

export async function updatePlaylist(
  id: number,
  title: string,
  description: string | null,
  image: PlaylistImageUpdate,
): Promise<void> {
  return invoke<void>("update_playlist", {
    id,
    title,
    description,
    imageMode: image.imageMode,
    customImagePath: image.customImagePath,
  });
}

export async function touchPlaylist(id: number): Promise<void> {
  return invoke<void>("touch_playlist", { id });
}

export async function addTracksToPlaylist(
  playlistId: number,
  trackIds: number[],
): Promise<void> {
  return invoke<void>("add_tracks_to_playlist", { playlistId, trackIds });
}

export async function removeTracksFromPlaylist(
  playlistId: number,
  trackIds: number[],
): Promise<void> {
  return invoke<void>("remove_tracks_from_playlist", { playlistId, trackIds });
}

export async function reorderPlaylistTracks(
  playlistId: number,
  trackIds: number[],
): Promise<void> {
  return invoke<void>("reorder_playlist_tracks", { playlistId, trackIds });
}

export async function deletePlaylist(id: number): Promise<void> {
  return invoke<void>("delete_playlist", { id });
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

export async function resolveCachedArtPath(
  filePath: string,
): Promise<string | null> {
  return invoke<string | null>("resolve_cached_art_path", { filePath });
}

export async function fetchCoverArt(
  artist: string,
  album: string,
  logContext?: ActivityLogContext,
): Promise<CoverArtCandidate[]> {
  const rows = await invoke<Record<string, unknown>[]>("fetch_cover_art", {
    artist,
    album,
    logContext: logContext ?? null,
  });
  return rows.map(normalizeCoverArtCandidate);
}

export async function fetchCoverArtForRelease(
  releaseMbid: string,
  logContext?: ActivityLogContext,
): Promise<CoverArtCandidate[]> {
  const rows = await invoke<Record<string, unknown>[]>(
    "fetch_cover_art_for_release",
    { releaseMbid, logContext: logContext ?? null },
  );
  return rows.map(normalizeCoverArtCandidate);
}

export async function fetchArtistArt(
  artist: string,
): Promise<CoverArtCandidate[]> {
  const rows = await invoke<Record<string, unknown>[]>("fetch_artist_art", {
    artist,
  });
  return rows.map(normalizeCoverArtCandidate);
}

export interface ArtistImageRecord {
  artistKey: string;
  browseMode: string;
  artPath: string;
}

function normalizeArtistImage(raw: Record<string, unknown>): ArtistImageRecord {
  return {
    artistKey:
      (raw.artistKey as string) ?? (raw.artist_key as string) ?? "",
    browseMode:
      (raw.browseMode as string) ?? (raw.browse_mode as string) ?? "",
    artPath: (raw.artPath as string) ?? (raw.art_path as string) ?? "",
  };
}

export async function getArtistImages(): Promise<ArtistImageRecord[]> {
  const rows = await invoke<Record<string, unknown>[]>("get_artist_images");
  return rows.map(normalizeArtistImage);
}

export async function saveArtistImage(
  artistKey: string,
  browseMode: string,
  artPath: string | null,
): Promise<void> {
  await invoke<void>("save_artist_image", {
    artistKey,
    browseMode,
    artPath,
  });
}

export async function renameArtistImageKey(
  oldKey: string,
  newKey: string,
  browseMode: string,
): Promise<void> {
  await invoke<void>("rename_artist_image_key", {
    oldKey,
    newKey,
    browseMode,
  });
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

export async function revealPathInFileManager(path: string): Promise<void> {
  await revealItemInDir(path);
}

export async function importUserTheme(): Promise<Theme | null> {
  return invoke<Theme | null>("import_user_theme");
}

export async function listSkins(): Promise<SkinSummary[]> {
  return invoke<SkinSummary[]>("list_skins");
}

export async function loadSkinPack(skinId: string): Promise<LoadedSkinPack> {
  return invoke<LoadedSkinPack>("load_skin_pack", { skinId });
}

export async function getActiveSkinId(): Promise<string> {
  return invoke<string>("get_active_skin_id");
}

export async function saveActiveSkinId(skinId: string): Promise<void> {
  return invoke<void>("save_active_skin_id", { skinId });
}

export async function getActiveSkinView(): Promise<string> {
  return invoke<string>("get_active_skin_view");
}

export async function saveActiveSkinView(viewId: string): Promise<void> {
  return invoke<void>("save_active_skin_view", { viewId });
}

export async function openSkinsFolder(): Promise<void> {
  return invoke<void>("open_skins_folder");
}

export async function listVisualizers(): Promise<VizSummary[]> {
  return invoke<VizSummary[]>("list_visualizers");
}

export async function loadVisualizerPack(
  packId: string,
): Promise<LoadedVisualizerPack> {
  return invoke<LoadedVisualizerPack>("load_visualizer_pack", { packId });
}

export async function getActiveVisualizerId(): Promise<string> {
  return invoke<string>("get_active_visualizer_id");
}

export async function saveActiveVisualizerId(packId: string): Promise<void> {
  return invoke<void>("save_active_visualizer_id", { packId });
}

export async function openVisualizersFolder(): Promise<void> {
  return invoke<void>("open_visualizers_folder");
}

export interface EqualizerSettings {
  enabled: boolean;
  presetId: string;
  bands: number[];
  preampGain: number;
}

export interface EqualizerPresetRecord {
  id: string;
  name: string;
  bands: number[];
}

export async function getEqualizerSettings(): Promise<EqualizerSettings> {
  return invoke<EqualizerSettings>("get_equalizer_settings");
}

export async function saveEqualizerSettings(
  settings: EqualizerSettings,
): Promise<void> {
  return invoke<void>("save_equalizer_settings", { settings });
}

export async function listEqualizerCustomPresets(): Promise<
  EqualizerPresetRecord[]
> {
  return invoke<EqualizerPresetRecord[]>("list_equalizer_custom_presets");
}

export async function saveEqualizerCustomPreset(
  preset: EqualizerPresetRecord,
): Promise<void> {
  return invoke<void>("save_equalizer_custom_preset", { preset });
}

export async function deleteEqualizerCustomPreset(id: string): Promise<void> {
  return invoke<void>("delete_equalizer_custom_preset", { id });
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
): Promise<string> {
  return invoke<string>("prepare_import_file", { sourcePath, mode });
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

export async function quitApp(): Promise<void> {
  await invoke<void>("quit_app");
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
      | "discNumber"
      | "dateAdded"
      | "playCount",
      number
    >
  >;
  hiddenColumns: string[];
  columnOrderByPreset: Partial<
    Record<"library" | "album" | "playlist" | "cd", string[]>
  >;
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

  const orderRaw =
    (raw.columnOrderByPreset as
      | Record<string, unknown>
      | undefined) ??
    (raw.column_order_by_preset as Record<string, unknown> | undefined);
  const columnOrderByPreset: TrackListPreferencesPayload["columnOrderByPreset"] =
    {};
  if (orderRaw && typeof orderRaw === "object") {
    for (const [presetKey, ids] of Object.entries(orderRaw)) {
      if (!Array.isArray(ids)) continue;
      columnOrderByPreset[presetKey as keyof typeof columnOrderByPreset] =
        ids.filter((v): v is string => typeof v === "string");
    }
  }

  return { columnWidths, hiddenColumns, columnOrderByPreset };
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

function normalizeCdDrive(raw: Record<string, unknown>): CdDrive {
  return {
    id: raw.id as string,
    name: raw.name as string,
    hasDisc: Boolean(raw.hasDisc ?? raw.has_disc),
  };
}

function normalizeCdTrack(raw: Record<string, unknown>): CdDisc["tracks"][number] {
  return {
    number: raw.number as number,
    title: raw.title as string,
    artist: (raw.artist as string | null | undefined) ?? null,
    durationSeconds:
      (raw.durationSeconds as number | null | undefined) ??
      (raw.duration_seconds as number | null | undefined) ??
      null,
  };
}

function normalizeCdDisc(raw: Record<string, unknown>): CdDisc {
  const tracksRaw = (raw.tracks as Record<string, unknown>[] | undefined) ?? [];
  return {
    driveId: (raw.driveId ?? raw.drive_id) as string,
    discId: (raw.discId ?? raw.disc_id ?? null) as string | null,
    album: (raw.album as string | null | undefined) ?? null,
    artist: (raw.artist as string | null | undefined) ?? null,
    tracks: tracksRaw.map(normalizeCdTrack),
  };
}

export async function listCdDrives(): Promise<CdDrive[]> {
  const rows = await invoke<Record<string, unknown>[]>("list_cd_drives");
  return rows.map(normalizeCdDrive);
}

export async function probeCdDrive(driveId: string): Promise<boolean> {
  return invoke<boolean>("probe_cd_drive", { driveId });
}

export async function getDiscInfo(driveId: string): Promise<CdDisc | null> {
  const raw = await invoke<Record<string, unknown> | null>("get_disc_info", {
    driveId,
  });
  return raw ? normalizeCdDisc(raw) : null;
}

function normalizeCdDiscCdText(raw: Record<string, unknown>): CdDiscCdText {
  const trackTitlesRaw =
    (raw.trackTitles as Record<string, unknown>[] | undefined) ??
    (raw.track_titles as Record<string, unknown>[] | undefined) ??
    [];
  return {
    driveId: (raw.driveId ?? raw.drive_id) as string,
    album: (raw.album as string | null | undefined) ?? null,
    artist: (raw.artist as string | null | undefined) ?? null,
    trackTitles: trackTitlesRaw.map((entry) => ({
      number: entry.number as number,
      title: entry.title as string,
    })),
  };
}

export async function getDiscCdText(
  driveId: string,
): Promise<CdDiscCdText | null> {
  const raw = await invoke<Record<string, unknown> | null>("get_disc_cdtext", {
    driveId,
  });
  return raw ? normalizeCdDiscCdText(raw) : null;
}

export async function ejectCdDisc(driveId: string): Promise<void> {
  await invoke("eject_cd_disc", { driveId });
}

export async function setCdDetailDrive(
  driveId: string | null,
): Promise<void> {
  await invoke("set_cd_detail_drive", { driveId });
}

function normalizeDiscTrackMetadata(
  raw: Record<string, unknown>,
): import("../types/cd").DiscTrackMetadata {
  return {
    number: raw.number as number,
    title: raw.title as string,
    artist: (raw.artist as string | null | undefined) ?? null,
  };
}

function normalizeDiscMetadata(raw: Record<string, unknown>): DiscMetadata {
  const tracksRaw =
    (raw.tracks as Record<string, unknown>[] | undefined) ?? [];
  return {
    discId: (raw.discId ?? raw.disc_id ?? null) as string | null,
    album: (raw.album as string | null | undefined) ?? null,
    albumArtist:
      (raw.albumArtist as string | null | undefined) ??
      (raw.album_artist as string | null | undefined) ??
      null,
    year: (raw.year as number | null | undefined) ?? null,
    country: (raw.country as string | null | undefined) ?? null,
    label: (raw.label as string | null | undefined) ?? null,
    releaseMbid:
      (raw.releaseMbid as string | null | undefined) ??
      (raw.release_mbid as string | null | undefined) ??
      null,
    tracks: tracksRaw.map(normalizeDiscTrackMetadata),
  };
}

function normalizeDiscMetadataLookup(
  raw: Record<string, unknown>,
): DiscMetadataLookup {
  const candidatesRaw =
    (raw.candidates as Record<string, unknown>[] | undefined) ?? [];
  const preferredRaw = raw.preferred as Record<string, unknown> | null | undefined;
  return {
    discId: (raw.discId ?? raw.disc_id ?? null) as string | null,
    candidates: candidatesRaw.map(normalizeDiscMetadata),
    preferred: preferredRaw ? normalizeDiscMetadata(preferredRaw) : null,
  };
}

function normalizeDiscMetadataCachePeek(
  raw: Record<string, unknown>,
): DiscMetadataCachePeek {
  const lookupRaw =
    (raw.lookup as Record<string, unknown> | undefined) ?? {};
  return {
    lookup: normalizeDiscMetadataLookup(lookupRaw),
    needsNetworkFetch: Boolean(
      raw.needsNetworkFetch ?? raw.needs_network_fetch,
    ),
  };
}

export async function peekDiscMetadataCache(
  driveId: string,
  tracks: DiscTocTrack[],
  logContext?: ActivityLogContext,
): Promise<DiscMetadataCachePeek> {
  const raw = await invoke<Record<string, unknown>>("peek_disc_metadata_cache", {
    driveId,
    tracks,
    logContext: logContext ?? null,
  });
  return normalizeDiscMetadataCachePeek(raw);
}

export async function lookupDiscMetadata(
  driveId: string,
  tracks: DiscTocTrack[],
  options?: { force?: boolean; logContext?: ActivityLogContext },
): Promise<DiscMetadataLookup> {
  const raw = await invoke<Record<string, unknown>>("lookup_disc_metadata", {
    driveId,
    tracks,
    forceRefresh: options?.force ?? false,
    logContext: options?.logContext ?? null,
  });
  return normalizeDiscMetadataLookup(raw);
}

export async function saveDiscMetadataPreference(
  discId: string,
  releaseMbid: string,
): Promise<void> {
  await invoke("save_disc_metadata_preference", { discId, releaseMbid });
}

export async function clearMetadataCache(): Promise<void> {
  await invoke("clear_metadata_cache");
}

export async function ripCdTrack(
  driveId: string,
  trackNumber: number,
  metadata: TrackMetadataUpdate,
): Promise<string> {
  return invoke<string>("rip_cd_track", {
    driveId,
    trackNumber,
    format: "flac",
    metadata,
  });
}

export async function cleanupCdImportTemp(driveId: string): Promise<void> {
  await invoke("cleanup_cd_rip_temp", { driveId });
}

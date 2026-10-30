import { Channel, invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { ItemSummary, ItemType } from "../types/item";
import type { SoundPackSummary } from "../types/soundPack";
import type { ReconcileSummary, Source } from "../types/source";
import type {
  ItemCatalogQuery,
  ItemDownloadProgress,
  ItemUpdateCheck,
  RegistryItemDetail,
  RegistryItemList,
  RegistrySource,
  RegistryVersionDetail,
} from "../types/itemRegistry";
import type {
  LibraryDestinationInfo,
  LibraryRelocateMode,
  LibrarySettings,
  LibrarySettingsPatch,
} from "../types/library";
import type {
  CdDisc,
  CdDiscCdText,
  CdDrive,
  DiscMetadata,
  DiscMetadataCachePeek,
  DiscMetadataLookup,
  DiscMetadataOverride,
  DiscTocTrack,
  DiscTrackOverride,
} from "../types/cd";
import type { TrackMetadataUpdate } from "../types/metadata";
import { parseRepeatMode } from "./playbackSession";
import type { PlaybackSession } from "../types/playbackSession";
import type { Theme } from "../types/theme";
import type { LoadedSkinPack, SkinSummary } from "../types/skin";
import type { SkinUserPreferences } from "../types/skinPreferences";
import type { LoadedVisualizer, VizSummary } from "../types/visualizer";
import type { CoverArtCandidate } from "../types/coverArt";
import type {
  MusicBrainzEntityHit,
  MusicBrainzEntityKind,
  MusicBrainzEntityLookup,
} from "../types/musicbrainz";
import type { ImageCrop } from "./imageCrop";
import type { Playlist } from "../types/playlist";
import type { PlaybackSettings } from "../types/playbackSettings";
import type { Track, TrackInput } from "../types/track";
import type {
  LyricsFetchOutcome,
  LyricsFormat,
  LyricsSearchCandidate,
  TrackLyrics,
  TrackLyricsInput,
} from "../types/lyrics";
import { normalizeTrackLyrics, normalizeTrackLyricsInput } from "./lyrics";
import type { ListenEventPayload } from "../types/listenEvent";
import type { ActivityLogContext } from "../types/activityLog";
import { reportSkinLayoutValidation } from "./skinLayoutReport";

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
    totalTracks:
      (raw.totalTracks as number | null) ??
      (raw.total_tracks as number | null) ??
      null,
    discNumber:
      (raw.discNumber as number | null) ??
      (raw.disc_number as number | null) ??
      null,
    totalDiscs:
      (raw.totalDiscs as number | null) ??
      (raw.total_discs as number | null) ??
      null,
    year: (raw.year as number | null) ?? null,
    genre: (raw.genre as string | null) ?? null,
    durationSeconds:
      (raw.durationSeconds as number | null) ??
      (raw.duration_seconds as number | null) ??
      null,
    sampleRate:
      (raw.sampleRate as number | null) ??
      (raw.sample_rate as number | null) ??
      null,
    bitrate: (raw.bitrate as number | null) ?? null,
    codec: (raw.codec as string | null) ?? null,
    filePath: (raw.filePath ?? raw.file_path) as string,
    artPath:
      (raw.artPath as string | null) ?? (raw.art_path as string | null) ?? null,
    dateAdded: (raw.dateAdded ?? raw.date_added) as string,
    playCount:
      (raw.playCount as number | undefined) ??
      (raw.play_count as number | undefined) ??
      0,
    lastPlayedAt:
      ((raw.lastPlayedAt as string | null | undefined) ??
        (raw.last_played_at as string | null | undefined)) ||
      null,
    rating: (raw.rating as number | undefined) ?? 0,
    lyricsFormat:
      (raw.lyricsFormat as LyricsFormat | null | undefined) ??
      (raw.lyrics_format as LyricsFormat | null | undefined) ??
      null,
    recordingMbid:
      (raw.recordingMbid as string | null | undefined) ??
      (raw.recording_mbid as string | null | undefined) ??
      null,
    releaseMbid:
      (raw.releaseMbid as string | null | undefined) ??
      (raw.release_mbid as string | null | undefined) ??
      null,
    artistMbids:
      stringArray(raw.artistMbids) ?? stringArray(raw.artist_mbids) ?? [],
    albumArtistMbids:
      stringArray(raw.albumArtistMbids) ??
      stringArray(raw.album_artist_mbids) ??
      [],
  };
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

export type ListenEventInput = ListenEventPayload;

export interface RecordListenEventResult {
  eventId: number;
  playCount: number;
  lastPlayedAt: string;
  counted: boolean;
}

export async function recordListenEvent(
  event: ListenEventInput,
): Promise<RecordListenEventResult> {
  const raw = await invoke<Record<string, unknown>>("record_listen_event", {
    event,
  });
  return {
    eventId: (raw.eventId ?? raw.event_id) as number,
    playCount: (raw.playCount ?? raw.play_count) as number,
    lastPlayedAt: (raw.lastPlayedAt ?? raw.last_played_at) as string,
    counted: Boolean(raw.counted ?? false),
  };
}

export interface ClearListenHistoryResult {
  deletedEvents: number;
  resetCounters: boolean;
}

/** Clear recent listens. Omit `withinHours` (or pass null) for all time. */
export async function clearListenHistory(options?: {
  withinHours?: number | null;
}): Promise<ClearListenHistoryResult> {
  const raw = await invoke<Record<string, unknown>>("clear_listen_history", {
    withinHours: options?.withinHours ?? null,
  });
  return {
    deletedEvents: (raw.deletedEvents ?? raw.deleted_events) as number,
    resetCounters: Boolean(raw.resetCounters ?? raw.reset_counters),
  };
}

export async function setTrackRating(
  trackId: number,
  rating: number,
): Promise<number> {
  return invoke<number>("set_track_rating", { trackId, rating });
}

export async function getTrackLyrics(
  trackId: number,
): Promise<TrackLyrics | null> {
  const raw = await invoke<Record<string, unknown> | null>("get_track_lyrics", {
    trackId,
  });
  return raw ? normalizeTrackLyrics(raw) : null;
}

function normalizeLyricsSearchCandidate(
  raw: Record<string, unknown>,
): LyricsSearchCandidate {
  return {
    id: raw.id as number,
    trackName:
      (raw.trackName as string | undefined) ??
      (raw.track_name as string | undefined) ??
      "",
    artistName:
      (raw.artistName as string | undefined) ??
      (raw.artist_name as string | undefined) ??
      "",
    albumName:
      (raw.albumName as string | undefined) ??
      (raw.album_name as string | undefined) ??
      "",
    duration: (raw.duration as number | undefined) ?? 0,
    lyrics: normalizeTrackLyricsInput(
      (raw.lyrics as Record<string, unknown> | undefined) ?? {},
    ),
  };
}

function normalizeLyricsFetchOutcome(
  raw: Record<string, unknown>,
): LyricsFetchOutcome {
  const status = (raw.status as string | undefined) ?? "not_found";
  if (status === "found") {
    return {
      status: "found",
      lyrics: normalizeTrackLyricsInput(
        (raw.lyrics as Record<string, unknown> | undefined) ?? {},
      ),
    };
  }
  if (status === "ambiguous") {
    const candidates = Array.isArray(raw.candidates)
      ? raw.candidates.map((candidate) =>
          normalizeLyricsSearchCandidate(candidate as Record<string, unknown>),
        )
      : [];
    return { status: "ambiguous", candidates };
  }
  if (status === "instrumental") {
    return { status: "instrumental" };
  }
  return { status: "not_found" };
}

export type LyricsFetchCachePeek =
  "notCached" | "miss" | "hit" | "instrumental";

export async function peekLyricsFetchCache(params: {
  artist: string;
  title: string;
  durationSeconds?: number | null;
}): Promise<LyricsFetchCachePeek> {
  return invoke<LyricsFetchCachePeek>("peek_lyrics_fetch_cache", {
    artist: params.artist,
    title: params.title,
    durationSeconds: params.durationSeconds ?? null,
  });
}

export async function markTrackInstrumental(trackId: number): Promise<Track> {
  const raw = await invoke<Record<string, unknown>>("mark_track_instrumental", {
    trackId,
  });
  return normalizeTrack(raw);
}

/**
 * Save fetched lyrics in the library. The file's tags and sidecar are updated
 * only when the track's source is writable.
 */
export async function saveTrackLyrics(
  trackId: number,
  lyrics: TrackLyricsInput | null,
): Promise<Track> {
  const raw = await invoke<Record<string, unknown>>("save_track_lyrics", {
    trackId,
    lyrics,
  });
  return normalizeTrack(raw);
}

export async function fetchLyricsLrclib(
  params: {
    artist: string;
    albumArtist?: string;
    title: string;
    album: string;
    durationSeconds?: number | null;
  },
  options?: { respectMissCache?: boolean },
): Promise<LyricsFetchOutcome> {
  const raw = await invoke<Record<string, unknown>>("fetch_lyrics_lrclib", {
    artist: params.artist,
    albumArtist: params.albumArtist ?? "",
    title: params.title,
    album: params.album,
    durationSeconds: params.durationSeconds ?? null,
    respectMissCache: options?.respectMissCache ?? false,
  });
  return normalizeLyricsFetchOutcome(raw);
}

export async function cancelLyricsFetch(): Promise<void> {
  await invoke("cancel_lyrics_fetch");
}

export async function clearLyricsFetchCancel(): Promise<void> {
  await invoke("clear_lyrics_fetch_cancel");
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

export interface ZipImportScan {
  extractDir: string;
  audioPaths: string[];
}

export async function scanZipImport(zipPath: string): Promise<ZipImportScan> {
  const result = await invoke<{ extract_dir: string; audio_paths: string[] }>(
    "scan_zip_import",
    { zipPath },
  );
  return {
    extractDir: result.extract_dir,
    audioPaths: result.audio_paths,
  };
}

export async function cleanupZipImport(extractDir: string): Promise<void> {
  await invoke<void>("cleanup_zip_import", { extractDir });
}

export async function getFileSize(path: string): Promise<number> {
  return invoke<number>("get_file_size", { path });
}

export async function getDirectorySize(path: string): Promise<number> {
  return invoke<number>("get_directory_size", { path });
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
  const row = await invoke<Record<string, unknown>>(
    "replace_track_from_import",
    {
      trackId: options.trackId,
      sourcePath: options.sourcePath,
      mode: options.mode,
      track: options.track,
    },
  );
  return normalizeTrack(row);
}

export async function convertTrack(options: {
  trackId: number;
  profileId: string;
  mode: "replace" | "add_new";
}): Promise<Track> {
  const row = await invoke<Record<string, unknown>>("convert_track", {
    trackId: options.trackId,
    profileId: options.profileId,
    mode: options.mode,
  });
  return normalizeTrack(row);
}

export interface ConvertProfileOptions {
  profileIds: string[];
  defaultProfileId: string;
  sourceProfileId?: string | null;
}

export async function getConvertProfileOptions(
  sourcePaths: string[],
): Promise<ConvertProfileOptions> {
  return invoke<ConvertProfileOptions>("get_convert_profile_options", {
    sourcePaths,
  });
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

export interface RefreshLibraryMetadataResult {
  updated: number;
  missing: number;
  failed: number;
  errors: string[];
}

export async function refreshLibraryMetadataFromFiles(): Promise<RefreshLibraryMetadataResult> {
  return invoke<RefreshLibraryMetadataResult>("refresh_library_metadata");
}

/**
 * Emitted by the backend when a source's tracks changed on disk (a scan added,
 * updated or marked tracks missing) or a source was added, moved or removed.
 */
export const LIBRARY_TRACKS_CHANGED_EVENT = "library://tracks-changed";

export async function listSources(): Promise<Source[]> {
  return invoke<Source[]>("list_sources");
}

/** Add a folder the user picked as a watched source; it is scanned in the background. */
export async function addWatchedSource(
  rootPath: string,
  name?: string,
): Promise<Source> {
  return invoke<Source>("add_watched_source", { rootPath, name: name ?? null });
}

/** Stop watching a folder. Its tracks leave the library; its files stay. Returns tracks removed. */
export async function removeWatchedSource(sourceId: number): Promise<number> {
  return invoke<number>("remove_watched_source", { sourceId });
}

export async function rescanSource(
  sourceId: number,
): Promise<ReconcileSummary> {
  return invoke<ReconcileSummary>("rescan_source", { sourceId });
}

/** Point a watched source at the folder its files moved to, then rescan it. */
export async function relocateWatchedSource(
  sourceId: number,
  newRootPath: string,
): Promise<Source> {
  return invoke<Source>("relocate_watched_source", { sourceId, newRootPath });
}

export async function setSourceWritable(
  sourceId: number,
  writable: boolean,
): Promise<Source> {
  return invoke<Source>("set_source_writable", { sourceId, writable });
}

function normalizePlaylistImageMode(
  raw: Record<string, unknown>,
): Playlist["imageMode"] {
  const mode = (raw.imageMode ?? raw.image_mode) as string | undefined;
  if (mode === "custom") return "custom";
  if (mode === "design") return "design";
  return "generated";
}

function normalizePlaylist(raw: Record<string, unknown>): Playlist {
  return {
    id: raw.id as number,
    title: raw.title as string,
    description: (raw.description as string | null | undefined) ?? null,
    dateCreated: (raw.dateCreated ?? raw.date_created) as string,
    lastUsedAt: (raw.lastUsedAt ?? raw.last_used_at) as string,
    trackIds: (raw.trackIds ?? raw.track_ids ?? []) as number[],
    imageMode: normalizePlaylistImageMode(raw),
    customImagePath: (raw.customImagePath ?? raw.custom_image_path ?? null) as
      string | null,
    coverBackground: (raw.coverBackground ?? raw.cover_background ?? null) as
      string | null,
    coverBackgroundEnd: (raw.coverBackgroundEnd ??
      raw.cover_background_end ??
      null) as string | null,
    coverIcon: (raw.coverIcon ?? raw.cover_icon ?? null) as string | null,
  };
}

export async function getPlaylists(): Promise<Playlist[]> {
  const rows = await invoke<Record<string, unknown>[]>("get_playlists");
  return rows.map(normalizePlaylist);
}

export interface PlaylistImageUpdate {
  imageMode: Playlist["imageMode"];
  customImagePath: string | null;
  coverBackground: string | null;
  coverBackgroundEnd: string | null;
  coverIcon: string | null;
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
    coverBackground: image.coverBackground,
    coverBackgroundEnd: image.coverBackgroundEnd,
    coverIcon: image.coverIcon,
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
    coverBackground: image.coverBackground,
    coverBackgroundEnd: image.coverBackgroundEnd,
    coverIcon: image.coverIcon,
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

export async function reorderPlaylists(playlistIds: number[]): Promise<void> {
  return invoke<void>("reorder_playlists", { playlistIds });
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
  crop?: ImageCrop | null,
  maxEdge?: number | null,
): Promise<string> {
  return invoke<string>("cache_art_from_file", {
    sourcePath,
    filePath,
    crop: crop ?? null,
    maxEdge: maxEdge ?? null,
  });
}

export async function measureArtSizes(
  sourcePath: string,
  crop: ImageCrop,
  maxEdges: (number | null)[],
): Promise<{ sourceBytes: number; outputBytes: number[] }> {
  return invoke("measure_art_sizes", { sourcePath, crop, maxEdges });
}

/** Frees the decoded source the backend keeps while sizes are being measured. */
export async function clearArtMeasureCache(): Promise<void> {
  return invoke<void>("clear_art_measure_cache");
}

export async function storeCroppedPlaylistArt(
  playlistId: number,
  title: string,
  sourcePath: string,
  crop: ImageCrop,
): Promise<string> {
  return invoke<string>("store_cropped_playlist_art", {
    playlistId,
    title,
    sourcePath,
    crop,
  });
}

export async function cacheArtFromBytes(
  bytes: number[],
  filePath: string,
  format: string,
): Promise<string> {
  return invoke<string>("cache_art_from_bytes", { bytes, filePath, format });
}

export type CachedArtFromUrl = {
  path: string;
  byteCount: number;
};

export async function cacheArtFromUrl(
  url: string,
  filePath: string,
  logContext?: ActivityLogContext,
): Promise<CachedArtFromUrl> {
  const raw = await invoke<Record<string, unknown>>("cache_art_from_url", {
    url,
    filePath,
    logContext: logContext ?? null,
  });
  return {
    path: String(raw.path ?? ""),
    byteCount: Number(raw.byteCount ?? raw.byte_count ?? 0),
  };
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
  artistMbid?: string | null,
  logContext?: ActivityLogContext,
): Promise<CoverArtCandidate[]> {
  const rows = await invoke<Record<string, unknown>[]>("fetch_artist_art", {
    artist,
    artistMbid: artistMbid?.trim() || null,
    logContext: logContext ?? null,
  });
  return rows.map(normalizeCoverArtCandidate);
}

export async function searchMusicBrainzEntities(
  kind: MusicBrainzEntityKind,
  query: string,
  artist?: string | null,
): Promise<MusicBrainzEntityHit[]> {
  const rows = await invoke<Record<string, unknown>[]>(
    "search_musicbrainz_entities",
    {
      kind,
      query,
      artist: artist?.trim() || null,
    },
  );
  return rows.map(normalizeMusicBrainzEntityHit);
}

/** DB-only. Returns null on cache miss. Never contacts MusicBrainz. */
const musicBrainzEntityMemory = new Map<
  string,
  MusicBrainzEntityLookup | null
>();
const musicBrainzEntityInflight = new Map<
  string,
  Promise<MusicBrainzEntityLookup | null>
>();

function musicBrainzEntityMemoryKey(
  kind: MusicBrainzEntityKind,
  mbid: string,
): string {
  return `${kind}:${mbid.trim().toLowerCase()}`;
}

/** Sync peek of an in-memory warm of a prior get/fetch (undefined = not warmed). */
export function peekMusicBrainzEntity(
  kind: MusicBrainzEntityKind,
  mbid: string,
): MusicBrainzEntityLookup | null | undefined {
  const key = musicBrainzEntityMemoryKey(kind, mbid);
  if (!musicBrainzEntityMemory.has(key)) return undefined;
  return musicBrainzEntityMemory.get(key);
}

/** Fire-and-forget DB read so the MusicBrainz tab can paint without a flash. */
export function warmMusicBrainzEntity(
  kind: MusicBrainzEntityKind,
  mbid: string | null | undefined,
): void {
  const trimmed = mbid?.trim();
  if (!trimmed) return;
  void getMusicBrainzEntity(kind, trimmed);
}

export async function getMusicBrainzEntity(
  kind: MusicBrainzEntityKind,
  mbid: string,
): Promise<MusicBrainzEntityLookup | null> {
  const key = musicBrainzEntityMemoryKey(kind, mbid);
  if (musicBrainzEntityMemory.has(key)) {
    return musicBrainzEntityMemory.get(key) ?? null;
  }
  const inflight = musicBrainzEntityInflight.get(key);
  if (inflight) return inflight;

  const pending = (async () => {
    const raw = await invoke<Record<string, unknown> | null>(
      "get_musicbrainz_entity",
      { kind, mbid },
    );
    const lookup = raw == null ? null : normalizeMusicBrainzEntityLookup(raw);
    musicBrainzEntityMemory.set(key, lookup);
    return lookup;
  })().finally(() => {
    musicBrainzEntityInflight.delete(key);
  });

  musicBrainzEntityInflight.set(key, pending);
  return pending;
}

/** Explicit network fetch; upserts into Library.db. */
export async function fetchMusicBrainzEntity(
  kind: MusicBrainzEntityKind,
  mbid: string,
): Promise<MusicBrainzEntityLookup | null> {
  const raw = await invoke<Record<string, unknown> | null>(
    "fetch_musicbrainz_entity",
    { kind, mbid },
  );
  const lookup = raw == null ? null : normalizeMusicBrainzEntityLookup(raw);
  musicBrainzEntityMemory.set(musicBrainzEntityMemoryKey(kind, mbid), lookup);
  return lookup;
}

/**
 * Prefer cache; fetch only when cold. Use when Save after assigning a release
 * needs a tracklist and the pick path may not have warmed the cache.
 */
export async function getOrFetchMusicBrainzEntity(
  kind: MusicBrainzEntityKind,
  mbid: string,
): Promise<MusicBrainzEntityLookup | null> {
  const cached = await getMusicBrainzEntity(kind, mbid);
  if (cached != null) return cached;
  return fetchMusicBrainzEntity(kind, mbid);
}

function normalizeMusicBrainzEntityLookup(
  raw: Record<string, unknown>,
): MusicBrainzEntityLookup {
  const hitRaw = (raw.hit as Record<string, unknown> | undefined) ?? raw;
  const tracklistRaw = raw.tracklist;
  const tracklist = Array.isArray(tracklistRaw)
    ? tracklistRaw.map((slot) => {
        const row = slot as Record<string, unknown>;
        return {
          discNumber: Number(row.discNumber ?? row.disc_number ?? 0),
          trackNumber: Number(row.trackNumber ?? row.track_number ?? 0),
          recordingMbid:
            (row.recordingMbid as string | null | undefined) ??
            (row.recording_mbid as string | null | undefined) ??
            null,
        };
      })
    : [];
  return {
    hit: normalizeMusicBrainzEntityHit(hitRaw),
    tracklist,
  };
}

function normalizeMusicBrainzEntityHit(
  raw: Record<string, unknown>,
): MusicBrainzEntityHit {
  const kind = String(raw.kind ?? "") as MusicBrainzEntityKind;
  return {
    kind,
    mbid: String(raw.mbid ?? ""),
    title: String(raw.title ?? ""),
    artist: (raw.artist as string | null | undefined) ?? null,
    disambiguation: (raw.disambiguation as string | null | undefined) ?? null,
    year: (raw.year as number | null | undefined) ?? null,
    country: (raw.country as string | null | undefined) ?? null,
    label: (raw.label as string | null | undefined) ?? null,
    entityType: (raw.entityType as string | null | undefined) ?? null,
    area: (raw.area as string | null | undefined) ?? null,
    trackCount: (raw.trackCount as number | null | undefined) ?? null,
  };
}

export interface ArtistImageRecord {
  artistKey: string;
  artPath: string;
}

function normalizeArtistImage(raw: Record<string, unknown>): ArtistImageRecord {
  return {
    artistKey: (raw.artistKey as string) ?? (raw.artist_key as string) ?? "",
    artPath: (raw.artPath as string) ?? (raw.art_path as string) ?? "",
  };
}

export async function getArtistImages(): Promise<ArtistImageRecord[]> {
  const rows = await invoke<Record<string, unknown>[]>("get_artist_images");
  return rows.map(normalizeArtistImage);
}

export async function saveArtistImage(
  artistKey: string,
  artPath: string | null,
): Promise<void> {
  await invoke<void>("save_artist_image", {
    artistKey,
    artPath,
  });
}

export async function renameArtistImageKey(
  oldKey: string,
  newKey: string,
): Promise<string | null> {
  return invoke<string | null>("rename_artist_image_key", {
    oldKey,
    newKey,
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

export async function saveActiveThemeId(themeId: string): Promise<void> {
  return invoke<void>("save_active_theme_id", { themeId });
}

export async function saveThemeItem(theme: Theme): Promise<Theme> {
  return invoke<Theme>("save_theme", { theme });
}

/** Official registry source only (extra settings entries ignored until multi-registry UI). */
export async function getRegistries(): Promise<RegistrySource[]> {
  return invoke<RegistrySource[]>("get_registries");
}

/** Persist registry sources. Official Spiral URL is always retained. */
export async function saveRegistries(
  registries: RegistrySource[],
): Promise<RegistrySource[]> {
  return invoke<RegistrySource[]>("save_registries", { registries });
}

/** `GET /v1/items` against every configured registry (partial failure → `errors[]`). */
export async function fetchItemCatalog(
  query?: ItemCatalogQuery,
): Promise<RegistryItemList> {
  return invoke<RegistryItemList>("fetch_item_catalog", {
    query: query
      ? {
          itemTypes: query.itemTypes ?? [],
          q: query.q ?? null,
          publisherId: query.publisherId ?? null,
          sort: query.sort ?? null,
          limit: query.limit ?? null,
          offset: query.offset ?? null,
        }
      : null,
  });
}

/** `GET /v1/items/:publisher/:type/:id`: all published (non-yanked) versions. */
export async function fetchRegistryItem(args: {
  registryUrl: string;
  publisherId: string;
  itemType: string;
  id: string;
}): Promise<RegistryItemDetail> {
  return invoke<RegistryItemDetail>("fetch_registry_item", {
    registryUrl: args.registryUrl,
    publisherId: args.publisherId,
    itemType: args.itemType,
    id: args.id,
  });
}

/** `GET .../versions/:version` including README and CHANGELOG. `latest` is the newest. */
export async function fetchRegistryItemVersion(args: {
  registryUrl: string;
  publisherId: string;
  itemType: string;
  id: string;
  version: string;
}): Promise<RegistryVersionDetail> {
  return invoke<RegistryVersionDetail>("fetch_registry_item_version", {
    registryUrl: args.registryUrl,
    publisherId: args.publisherId,
    itemType: args.itemType,
    id: args.id,
    version: args.version,
  });
}

/** Ask every configured registry about newer versions of the installed items (one batch each). */
export async function checkItemUpdates(): Promise<ItemUpdateCheck> {
  return invoke<ItemUpdateCheck>("check_item_updates");
}

/** Running app semver used for catalog `minAppVersion` checks. */
export async function getAppVersion(): Promise<string> {
  return invoke<string>("get_app_version");
}

/** Whether the running app satisfies an optional catalog `minAppVersion`. */
export async function itemMeetsMinAppVersion(
  minAppVersion?: string | null,
): Promise<boolean> {
  return invoke<boolean>("item_meets_min_app_version", {
    minAppVersion: minAppVersion ?? null,
  });
}

/** Version of an item installed under `installed/`, or null. Reads disk only. */
export async function installedItemVersion(
  effectiveId: string,
): Promise<string | null> {
  return invoke<string | null>("installed_item_version", { effectiveId });
}

/**
 * Download + install by catalog identity from a configured registry base URL. The archive must
 * be the listed item and version, and it replaces whatever version is installed.
 */
export async function installItemFromRegistry(args: {
  registryUrl: string;
  publisherId: string;
  itemType: string;
  id: string;
  version: string;
  sha256: string;
  sizeBytes: number;
  minAppVersion?: string | null;
  /** Optional; invoke still requires a channel, so a no-op is used when omitted. */
  onProgress?: Channel<ItemDownloadProgress>;
}): Promise<InstallItemResult> {
  return invoke<InstallItemResult>("install_item_from_registry", {
    registryUrl: args.registryUrl,
    publisherId: args.publisherId,
    itemType: args.itemType,
    id: args.id,
    version: args.version,
    sha256: args.sha256,
    sizeBytes: args.sizeBytes,
    minAppVersion: args.minAppVersion ?? null,
    onProgress: args.onProgress ?? new Channel<ItemDownloadProgress>(),
  });
}

export async function cancelItemDownload(): Promise<void> {
  await invoke("cancel_item_download");
}

export async function clearItemDownloadCancel(): Promise<void> {
  await invoke("clear_item_download_cancel");
}

/**
 * Fetch a catalog item preview into the local registry-asset cache.
 * Returns a filesystem path for `convertFileSrc`, or null on soft failure.
 */
export async function resolveRegistryItemPreview(args: {
  registryUrl: string;
  previewUrl?: string | null;
}): Promise<string | null> {
  return invoke<string | null>("resolve_registry_item_preview", {
    registryUrl: args.registryUrl,
    previewUrl: args.previewUrl ?? null,
  });
}

/** Create a theme in `location` (an item folder, default under the Library's Packs) and link it. */
export async function createThemeItem(args?: {
  name?: string | null;
  location?: string | null;
}): Promise<Theme> {
  return invoke<Theme>("create_theme", {
    name: args?.name ?? null,
    location: args?.location ?? null,
  });
}

/** Folder the new-item dialog proposes for an item of `itemType` called `name`. */
export async function defaultNewItemLocation(
  itemType: ItemType,
  name: string,
): Promise<string> {
  return invoke<string>("default_new_item_location", { itemType, name });
}

/** Native folder picker for a new item's location; `null` when cancelled. */
export async function pickNewItemFolder(
  startAt?: string,
): Promise<string | null> {
  return invoke<string | null>("pick_new_item_folder", {
    startAt: startAt ?? null,
  });
}

export interface InstallItemResult {
  itemType: ItemType;
  id: string;
  publisherId: string;
  effectiveId: string;
  version: string;
  name: string;
  dir: string;
  /** Version that was replaced when the item was already installed. */
  replacedVersion: string | null;
}

/** Install a `.spk` into `packs/installed/`. Omit path to open a file picker. */
export async function installItem(
  path?: string | null,
): Promise<InstallItemResult | null> {
  return invoke<InstallItemResult | null>("install_item", {
    path: path ?? null,
  });
}

/** Every item across builtin / installed / linked. */
export async function listItems(): Promise<ItemSummary[]> {
  return invoke<ItemSummary[]>("list_items");
}

export interface ItemExportDefaults {
  effectiveId: string;
  itemType: ItemType;
  publisherId: string;
  name: string;
  version: string;
  description: string;
}

export async function getItemExportDefaults(
  itemId: string,
): Promise<ItemExportDefaults> {
  return invoke<ItemExportDefaults>("get_item_export_defaults", { itemId });
}

export interface ExportItemResult {
  path: string;
  effectiveId: string;
  version: string;
}

/** Export a linked item to `.spk` (opens a save dialog; `null` if cancelled). */
export async function exportItem(args: {
  itemId: string;
  name: string;
  version: string;
  description?: string;
}): Promise<ExportItemResult | null> {
  return invoke<ExportItemResult | null>("export_item", {
    itemId: args.itemId,
    name: args.name,
    version: args.version,
    description: args.description ?? null,
  });
}

/** Link an external item folder. Omit path to open a directory picker. */
export async function linkItemFolder(
  path?: string | null,
): Promise<string | null> {
  return invoke<string | null>("link_item_folder", { path: path ?? null });
}

/** Remove a path from linkedItemPaths; never deletes the folder. */
export async function unlinkItem(path: string): Promise<void> {
  return invoke<void>("unlink_item", { path });
}

export async function getItemScanWarnings(): Promise<string[]> {
  return invoke<string[]>("get_item_scan_warnings");
}

/** Update an authoring item's identity and display fields. Returns the new effective id. */
export async function updateItemMetadata(
  itemId: string,
  metadata: {
    id: string;
    publisherId: string;
    name: string;
    version: string;
    description: string;
  },
): Promise<string> {
  return invoke<string>("update_item_metadata", {
    itemId,
    newId: metadata.id,
    publisherId: metadata.publisherId,
    name: metadata.name,
    version: metadata.version,
    description: metadata.description,
  });
}

/** Preferences → Studio → Default Publisher ID. */
export async function getDefaultPublisherId(): Promise<string> {
  return invoke<string>("get_default_publisher_id");
}

/** Persist Default Publisher ID (kebab slug). Empty input reseeds from the OS username. */
export async function saveDefaultPublisherId(
  publisherId: string,
): Promise<string> {
  return invoke<string>("save_default_publisher_id", { publisherId });
}

/** An item's manifest (`theme.json`, `skin.json`, `viz.json` or `sound.json`) as JSON. */
export async function readItemManifestJson(
  itemDir: string,
): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>("read_item_manifest_json", {
    itemDir,
  });
}

/** Optional item-root README.md; `null` when the file is absent. */
export async function readItemReadme(itemDir: string): Promise<string | null> {
  return invoke<string | null>("read_item_readme", { itemDir });
}

/** Write or delete item-root README.md for linked items (empty/whitespace deletes). */
export async function writeItemReadme(
  itemDir: string,
  content: string,
): Promise<void> {
  return invoke<void>("write_item_readme", { itemDir, content });
}

/** Optional item-root CHANGELOG.md; `null` when the file is absent. */
export async function readItemChangelog(
  itemDir: string,
): Promise<string | null> {
  return invoke<string | null>("read_item_changelog", { itemDir });
}

/** Write or delete item-root CHANGELOG.md for linked items (empty/whitespace deletes). */
export async function writeItemChangelog(
  itemDir: string,
  content: string,
): Promise<void> {
  return invoke<void>("write_item_changelog", { itemDir, content });
}

/** Delete a linked item's folder from disk and unlink it. Use `unlinkItem` to keep the files. */
export async function deleteLinkedItem(itemId: string): Promise<void> {
  return invoke<void>("delete_linked_item", { itemId });
}

/** Delete an installed item. */
export async function uninstallItem(itemId: string): Promise<void> {
  return invoke<void>("uninstall_item", { itemId });
}

export async function revealPathInFileManager(path: string): Promise<void> {
  await revealItemInDir(path);
}

/**
 * Show an item's folder in the file manager. Only folders of known items are
 * accepted, and the folder is revealed rather than opened, so an item folder
 * named like `foo.app` is never launched.
 */
export async function revealItemFolder(itemDir: string): Promise<void> {
  await invoke<void>("reveal_item_folder", { itemDir });
}

export async function listSkins(): Promise<SkinSummary[]> {
  return invoke<SkinSummary[]>("list_skins");
}

export async function listSoundPacks(): Promise<SoundPackSummary[]> {
  return invoke<SoundPackSummary[]>("list_sound_packs");
}

export async function getActiveSoundPackId(): Promise<string> {
  return invoke<string>("get_active_sound_pack_id");
}

export async function saveActiveSoundPackId(
  soundPackId: string,
): Promise<void> {
  return invoke<void>("save_active_sound_pack_id", { soundPackId });
}

/** Wav path for a cue from the active sound pack (default pack as fallback), or `null`. */
export async function resolveSoundCue(cue: string): Promise<string | null> {
  return invoke<string | null>("resolve_sound_cue", { cue });
}

/** Wav path of one sound in a specific pack, active or not. */
export async function resolveSoundPackAsset(
  soundPackId: string,
  soundId: string,
): Promise<string | null> {
  return invoke<string | null>("resolve_sound_pack_asset", {
    soundPackId,
    soundId,
  });
}

export async function loadSkinPack(skinId: string): Promise<LoadedSkinPack> {
  const pack = await invoke<LoadedSkinPack>("load_skin_pack", { skinId });
  reportSkinLayoutValidation(pack);
  return pack;
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

export async function getSkinPreferences(
  skinId: string,
): Promise<SkinUserPreferences> {
  return invoke<SkinUserPreferences>("get_skin_preferences", { skinId });
}

export async function saveSkinPreferences(
  skinId: string,
  preferences: SkinUserPreferences,
): Promise<void> {
  await invoke<void>("save_skin_preferences", { skinId, preferences });
}

export async function listVisualizers(): Promise<VizSummary[]> {
  return invoke<VizSummary[]>("list_visualizers");
}

export async function loadVisualizer(
  visualizerId: string,
): Promise<LoadedVisualizer> {
  return invoke<LoadedVisualizer>("load_visualizer", { visualizerId });
}

export async function getActiveVisualizerId(): Promise<string> {
  return invoke<string>("get_active_visualizer_id");
}

export async function saveActiveVisualizerId(
  visualizerId: string,
): Promise<void> {
  return invoke<void>("save_active_visualizer_id", { visualizerId });
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

export type { PlaybackSettings } from "../types/playbackSettings";

export async function getPlaybackSettings(): Promise<PlaybackSettings> {
  return invoke<PlaybackSettings>("get_playback_settings");
}

export async function savePlaybackSettings(
  settings: PlaybackSettings,
): Promise<void> {
  return invoke<void>("save_playback_settings", { settings });
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

/** Move Artwork/albums/{old} → {new} and rewrite relative art_path prefixes. */
export async function renameAlbumArtwork(args: {
  oldAlbumArtist?: string | null;
  oldArtist?: string | null;
  oldAlbum?: string | null;
  newAlbumArtist?: string | null;
  newArtist?: string | null;
  newAlbum?: string | null;
}): Promise<void> {
  await invoke<void>("rename_album_artwork", {
    oldAlbumArtist: args.oldAlbumArtist ?? null,
    oldArtist: args.oldArtist ?? null,
    oldAlbum: args.oldAlbum ?? null,
    newAlbumArtist: args.newAlbumArtist ?? null,
    newArtist: args.newArtist ?? null,
    newAlbum: args.newAlbum ?? null,
  });
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

/** `startDir` is where the picker opens (nearest existing folder if it is missing). */
export async function pickLibraryFolder(
  startDir?: string,
): Promise<string | null> {
  return invoke<string | null>("pick_library_folder", { startDir });
}

export async function inspectLibraryDestination(
  path: string,
): Promise<LibraryDestinationInfo> {
  return invoke<LibraryDestinationInfo>("inspect_library_destination", {
    path,
  });
}

export async function relocateLibrary(
  newRoot: string,
  mode: LibraryRelocateMode,
): Promise<LibrarySettings> {
  return invoke<LibrarySettings>("relocate_library", { newRoot, mode });
}

function normalizePlaybackSession(
  raw: Record<string, unknown> | null | undefined,
): PlaybackSession | null {
  if (!raw) return null;
  return {
    playContextIds: (raw.playContextIds ??
      raw.play_context_ids ??
      []) as number[],
    manualQueueIds: (raw.manualQueueIds ??
      raw.manual_queue_ids ??
      []) as number[],
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
      | "playCount"
      | "lastPlayedAt"
      | "rating",
      number
    >
  >;
  hiddenColumnsByPreset: Partial<
    Record<"library" | "album" | "playlist" | "cd", string[]>
  >;
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

  const hiddenByPresetRaw =
    (raw.hiddenColumnsByPreset as Record<string, unknown> | undefined) ??
    (raw.hidden_columns_by_preset as Record<string, unknown> | undefined);
  const hiddenColumnsByPreset: TrackListPreferencesPayload["hiddenColumnsByPreset"] =
    {};
  if (hiddenByPresetRaw && typeof hiddenByPresetRaw === "object") {
    for (const [presetKey, ids] of Object.entries(hiddenByPresetRaw)) {
      if (!Array.isArray(ids)) continue;
      hiddenColumnsByPreset[presetKey as keyof typeof hiddenColumnsByPreset] =
        ids.filter((v): v is string => typeof v === "string");
    }
  }

  const legacyHiddenRaw =
    (raw.hiddenColumns as unknown[] | undefined) ??
    (raw.hidden_columns as unknown[] | undefined);
  if (
    !hiddenColumnsByPreset.library &&
    Array.isArray(legacyHiddenRaw) &&
    legacyHiddenRaw.length > 0
  ) {
    hiddenColumnsByPreset.library = legacyHiddenRaw.filter(
      (v): v is string => typeof v === "string",
    );
  }

  const orderRaw =
    (raw.columnOrderByPreset as Record<string, unknown> | undefined) ??
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

  return { columnWidths, hiddenColumnsByPreset, columnOrderByPreset };
}

export async function getTrackListPreferences(): Promise<TrackListPreferencesPayload> {
  const raw = await invoke<Record<string, unknown>>(
    "get_track_list_preferences",
  );
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

function normalizeCdTrack(
  raw: Record<string, unknown>,
): CdDisc["tracks"][number] {
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

export async function setCdDetailDrive(driveId: string | null): Promise<void> {
  await invoke("set_cd_detail_drive", { driveId });
}

function normalizeMbidList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (typeof value !== "string") return [];
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  });
}

function normalizeOptionalMbid(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed || null;
}

function normalizeDiscTrackMetadata(
  raw: Record<string, unknown>,
): import("../types/cd").DiscTrackMetadata {
  return {
    number: raw.number as number,
    title: raw.title as string,
    artist: (raw.artist as string | null | undefined) ?? null,
    recordingMbid: normalizeOptionalMbid(
      raw.recordingMbid ?? raw.recording_mbid,
    ),
    artistMbids: normalizeMbidList(raw.artistMbids ?? raw.artist_mbids),
  };
}

function normalizeDiscMetadata(raw: Record<string, unknown>): DiscMetadata {
  const tracksRaw = (raw.tracks as Record<string, unknown>[] | undefined) ?? [];
  return {
    discId: (raw.discId ?? raw.disc_id ?? null) as string | null,
    album: (raw.album as string | null | undefined) ?? null,
    albumArtist:
      (raw.albumArtist as string | null | undefined) ??
      (raw.album_artist as string | null | undefined) ??
      null,
    year: (raw.year as number | null | undefined) ?? null,
    genre: (raw.genre as string | null | undefined) ?? null,
    country: (raw.country as string | null | undefined) ?? null,
    label: (raw.label as string | null | undefined) ?? null,
    releaseMbid: normalizeOptionalMbid(raw.releaseMbid ?? raw.release_mbid),
    albumArtistMbids: normalizeMbidList(
      raw.albumArtistMbids ?? raw.album_artist_mbids,
    ),
    tracks: tracksRaw.map(normalizeDiscTrackMetadata),
  };
}

function normalizeDiscMetadataLookup(
  raw: Record<string, unknown>,
): DiscMetadataLookup {
  const candidatesRaw =
    (raw.candidates as Record<string, unknown>[] | undefined) ?? [];
  const preferredRaw = raw.preferred as
    Record<string, unknown> | null | undefined;
  return {
    discId: (raw.discId ?? raw.disc_id ?? null) as string | null,
    candidates: candidatesRaw.map(normalizeDiscMetadata),
    preferred: preferredRaw ? normalizeDiscMetadata(preferredRaw) : null,
    kind:
      raw.kind === "hit" || raw.kind === "miss" || raw.kind === "error"
        ? raw.kind
        : undefined,
  };
}

function normalizeDiscMetadataCachePeek(
  raw: Record<string, unknown>,
): DiscMetadataCachePeek {
  const lookupRaw = (raw.lookup as Record<string, unknown> | undefined) ?? {};
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
  const raw = await invoke<Record<string, unknown>>(
    "peek_disc_metadata_cache",
    {
      driveId,
      tracks,
      logContext: logContext ?? null,
    },
  );
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

function presentStringField(
  raw: Record<string, unknown>,
  camel: string,
  snake: string,
): string | undefined {
  if (!(camel in raw) && !(snake in raw)) return undefined;
  return String((raw[camel] ?? raw[snake] ?? "") as string);
}

function normalizeDiscTrackOverride(
  raw: Record<string, unknown> | null | undefined,
): DiscTrackOverride {
  if (raw == null) return {};
  const recordingMbid = presentStringField(
    raw,
    "recordingMbid",
    "recording_mbid",
  );
  return {
    title: (raw.title as string | null | undefined) ?? null,
    artist: (raw.artist as string | null | undefined) ?? null,
    rating:
      raw.rating == null
        ? null
        : Number.isFinite(Number(raw.rating))
          ? Number(raw.rating)
          : null,
    ...(recordingMbid !== undefined ? { recordingMbid } : {}),
  };
}

function normalizeDiscMetadataOverride(
  raw: Record<string, unknown> | null | undefined,
): DiscMetadataOverride {
  if (raw == null) return {};
  const tracksRaw = (raw.tracks ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const tracks: Record<string, DiscTrackOverride> = {};
  for (const [number, track] of Object.entries(tracksRaw)) {
    tracks[number] = normalizeDiscTrackOverride(track);
  }
  const releaseMbid = presentStringField(raw, "releaseMbid", "release_mbid");
  return {
    album: (raw.album as string | null | undefined) ?? null,
    albumArtist:
      (raw.albumArtist as string | null | undefined) ??
      (raw.album_artist as string | null | undefined) ??
      null,
    year:
      raw.year == null
        ? null
        : Number.isFinite(Number(raw.year))
          ? Number(raw.year)
          : null,
    genre: (raw.genre as string | null | undefined) ?? null,
    artPath:
      (raw.artPath as string | null | undefined) ??
      (raw.art_path as string | null | undefined) ??
      null,
    ...(releaseMbid !== undefined ? { releaseMbid } : {}),
    tracks,
  };
}

export async function getDiscMetadataOverride(
  discId: string,
): Promise<DiscMetadataOverride | null> {
  const raw = await invoke<Record<string, unknown> | null>(
    "get_disc_metadata_override",
    { discId },
  );
  if (raw == null) return null;
  return normalizeDiscMetadataOverride(raw);
}

export async function saveDiscMetadataOverride(
  discId: string,
  patch: DiscMetadataOverride,
): Promise<DiscMetadataOverride> {
  const raw = await invoke<Record<string, unknown>>(
    "save_disc_metadata_override",
    { discId, patch },
  );
  return normalizeDiscMetadataOverride(raw);
}

export async function clearDiscMetadataOverride(discId: string): Promise<void> {
  await invoke("clear_disc_metadata_override", { discId });
}

export async function clearMetadataCache(): Promise<void> {
  await invoke("clear_metadata_cache");
}

export async function ripCdTrack(
  driveId: string,
  trackNumber: number,
  profileId: string,
  metadata: TrackMetadataUpdate,
): Promise<string> {
  return invoke<string>("rip_cd_track", {
    driveId,
    trackNumber,
    profileId,
    metadata,
  });
}

export async function cleanupCdImportTemp(driveId: string): Promise<void> {
  await invoke("cleanup_cd_rip_temp", { driveId });
}

import { buildPlaybackOrder } from "./activeTrackList";
import { compareTracks } from "../components/TrackList/trackListSort";
import { findPlaybackTrack } from "./playbackTrack";
import {
  getPlaylistById,
  resolvePlaylistTracks,
  sortedPlaylists,
} from "./playlists";
import type { Playlist } from "../types/playlist";
import type { Track } from "../types/track";

export const SKIN_PLAYLIST_SOURCE_ALL = "all";
export const SKIN_PLAYLIST_SOURCE_UP_NEXT = "upNext";

export interface SkinPlaylistSourceOption {
  id: string;
  label: string;
}

export function playlistSourceIdForPlaylist(playlistId: number): string {
  return `playlist:${playlistId}`;
}

export function parsePlaylistSourceId(sourceId: string): {
  kind: "all" | "upNext" | "playlist";
  playlistId?: number;
} {
  if (sourceId === SKIN_PLAYLIST_SOURCE_ALL) {
    return { kind: "all" };
  }
  if (sourceId === SKIN_PLAYLIST_SOURCE_UP_NEXT) {
    return { kind: "upNext" };
  }
  if (sourceId.startsWith("playlist:")) {
    const playlistId = Number.parseInt(sourceId.slice("playlist:".length), 10);
    if (Number.isFinite(playlistId)) {
      return { kind: "playlist", playlistId };
    }
  }
  return { kind: "all" };
}

export function buildSkinPlaylistSourceOptions(
  playlists: Playlist[],
): SkinPlaylistSourceOption[] {
  const options: SkinPlaylistSourceOption[] = [
    { id: SKIN_PLAYLIST_SOURCE_ALL, label: "All tracks" },
    { id: SKIN_PLAYLIST_SOURCE_UP_NEXT, label: "Up Next" },
  ];

  for (const playlist of sortedPlaylists(playlists)) {
    options.push({
      id: playlistSourceIdForPlaylist(playlist.id),
      label: playlist.title,
    });
  }

  return options;
}

export function labelForSkinPlaylistSource(
  sourceId: string,
  playlists: Playlist[],
): string {
  return (
    buildSkinPlaylistSourceOptions(playlists).find((option) => option.id === sourceId)
      ?.label ?? "All tracks"
  );
}

export interface SkinPlaylistTrackContext {
  library: Track[];
  playbackTracks: Track[];
  cdQueueTracks?: Track[];
  playContextIds: number[];
  manualQueueIds: number[];
  currentTrackId: number | null;
  playlists: Playlist[];
}

export function resolveSkinPlaylistTrackIds(
  sourceId: string,
  ctx: SkinPlaylistTrackContext,
): number[] {
  const { kind, playlistId } = parsePlaylistSourceId(sourceId);

  if (kind === "all") {
    return [...ctx.library]
      .sort((a, b) => compareTracks(a, b, "title", "asc"))
      .map((track) => track.id);
  }

  if (kind === "upNext") {
    const activeIds = buildPlaybackOrder(
      ctx.manualQueueIds,
      ctx.playContextIds,
      ctx.library,
      ctx.currentTrackId,
    );

    if (activeIds.length === 0) return [];

    if (ctx.currentTrackId === null) {
      return activeIds;
    }

    const currentIdx = activeIds.indexOf(ctx.currentTrackId);
    if (currentIdx < 0) {
      return activeIds.filter((id) => id !== ctx.currentTrackId);
    }

    return activeIds.slice(currentIdx + 1);
  }

  if (playlistId == null) return [];
  const playlist = getPlaylistById(ctx.playlists, playlistId);
  if (!playlist) return [];
  return resolvePlaylistTracks(playlist, ctx.library).map((track) => track.id);
}

export function resolveSkinPlaylistTracks(
  sourceId: string,
  ctx: SkinPlaylistTrackContext,
): Track[] {
  return resolveSkinPlaylistTrackIds(sourceId, ctx)
    .map((id) =>
      findPlaybackTrack({
        library: ctx.library,
        playbackTracks: ctx.playbackTracks,
        cdQueueTracks: ctx.cdQueueTracks,
        currentTrackId: id,
      }),
    )
    .filter((track): track is Track => track != null);
}

export function resolveSkinPlaylistTrackCount(
  sourceId: string,
  ctx: SkinPlaylistTrackContext,
): number {
  return resolveSkinPlaylistTrackIds(sourceId, ctx).length;
}

export function shouldReplacePlayContextForSkinPlaylistSource(
  sourceId: string,
): boolean {
  const { kind } = parsePlaylistSourceId(sourceId);
  return kind === "all" || kind === "playlist";
}

import { mergeRemoteMetadataIntoDisc } from "./cdMetadata";
import { cdDiscTitle } from "./cdTracks";
import { getPlaylistById } from "./playlists";
import { getCdDriveById, useCdStore } from "../store/useCdStore";
import type { Artist } from "../types/artist";
import type { Playlist } from "../types/playlist";
import type { NavView } from "../store/useNavigationStore";

export type DetailReturnContext =
  | { kind: "sidebar"; view: NavView }
  | { kind: "artist"; artistKey: string }
  | { kind: "playlist"; playlistId: number; title: string }
  | { kind: "cd"; driveId: string; title: string };

export interface NavigationSnapshot {
  view: NavView;
  albumKey: string | null;
  artistKey: string | null;
  playlistId: number | null;
  cdDriveId: string | null;
}

const SIDEBAR_VIEW_LABELS: Record<NavView, string> = {
  library: "Tracks",
  albums: "Albums",
  artists: "Artists",
};

function cdNavigationTitle(driveId: string): string {
  const cdState = useCdStore.getState();
  const drive = getCdDriveById(cdState.drives, driveId);
  const fallback = drive?.name ?? "Disc Drive";
  const rawDisc = cdState.discsByDriveId[driveId];
  if (rawDisc == null) return fallback;
  const remoteMetadata = cdState.metadataByDriveId[driveId] ?? null;
  const disc =
    remoteMetadata != null
      ? mergeRemoteMetadataIntoDisc(rawDisc, remoteMetadata)
      : rawDisc;
  return cdDiscTitle(disc, fallback);
}

export function captureReturnContext(
  state: NavigationSnapshot,
  playlists: Playlist[],
): DetailReturnContext {
  if (state.cdDriveId != null) {
    return {
      kind: "cd",
      driveId: state.cdDriveId,
      title: cdNavigationTitle(state.cdDriveId),
    };
  }
  if (state.playlistId != null) {
    const playlist = getPlaylistById(playlists, state.playlistId);
    return {
      kind: "playlist",
      playlistId: state.playlistId,
      title: playlist?.title ?? "Playlist",
    };
  }
  if (state.artistKey != null) {
    return { kind: "artist", artistKey: state.artistKey };
  }
  return { kind: "sidebar", view: state.view };
}

export function detailReturnLabel(
  ctx: DetailReturnContext | null,
  artists: Artist[],
): string {
  if (!ctx) return "Back";

  switch (ctx.kind) {
    case "playlist":
      return ctx.title;
    case "cd":
      return cdNavigationTitle(ctx.driveId);
    case "artist": {
      const artist = artists.find((a) => a.key === ctx.artistKey);
      return artist?.name ?? "Artist";
    }
    case "sidebar":
      return SIDEBAR_VIEW_LABELS[ctx.view];
  }
}

export function stateAfterCloseAlbum(
  ctx: DetailReturnContext | null,
): Partial<NavigationSnapshot> {
  const base: Partial<NavigationSnapshot> = { albumKey: null };

  if (!ctx) return base;

  switch (ctx.kind) {
    case "playlist":
      return {
        ...base,
        playlistId: ctx.playlistId,
        artistKey: null,
      };
    case "cd":
      return {
        ...base,
        cdDriveId: ctx.driveId,
        artistKey: null,
        playlistId: null,
      };
    case "artist":
      return {
        ...base,
        artistKey: ctx.artistKey,
      };
    case "sidebar":
      return {
        ...base,
        artistKey: null,
        playlistId: null,
        cdDriveId: null,
        view: ctx.view,
      };
  }
}

export function stateAfterCloseCd(
  ctx: DetailReturnContext | null,
): Partial<NavigationSnapshot> {
  const base: Partial<NavigationSnapshot> = { cdDriveId: null };

  if (!ctx) return base;

  switch (ctx.kind) {
    case "cd":
      return {
        ...base,
        cdDriveId: ctx.driveId,
      };
    case "playlist":
      return {
        ...base,
        playlistId: ctx.playlistId,
      };
    case "artist":
      return {
        ...base,
        artistKey: ctx.artistKey,
      };
    case "sidebar":
      return {
        ...base,
        artistKey: null,
        playlistId: null,
        view: ctx.view,
      };
  }
}

export function stateAfterCloseArtist(
  ctx: DetailReturnContext | null,
): Partial<NavigationSnapshot> {
  const base: Partial<NavigationSnapshot> = { artistKey: null };

  if (!ctx) return base;

  switch (ctx.kind) {
    case "playlist":
      return {
        ...base,
        playlistId: ctx.playlistId,
      };
    case "cd":
      return {
        ...base,
        cdDriveId: ctx.driveId,
      };
    case "artist":
      return {
        ...base,
        artistKey: ctx.artistKey,
      };
    case "sidebar":
      return {
        ...base,
        playlistId: null,
        cdDriveId: null,
        view: ctx.view,
      };
  }
}

export function stateAfterClosePlaylist(
  ctx: DetailReturnContext | null,
): Partial<NavigationSnapshot> {
  const base: Partial<NavigationSnapshot> = { playlistId: null };

  if (!ctx) return base;

  switch (ctx.kind) {
    case "playlist":
      return {
        ...base,
        playlistId: ctx.playlistId,
      };
    case "cd":
      return {
        ...base,
        cdDriveId: ctx.driveId,
      };
    case "artist":
      return {
        ...base,
        artistKey: ctx.artistKey,
      };
    case "sidebar":
      return {
        ...base,
        artistKey: null,
        cdDriveId: null,
        view: ctx.view,
      };
  }
}

import { mergeRemoteMetadataIntoDisc } from "./cdMetadata";
import { cdSidebarDiscLabel } from "./cdTracks";
import { getPlaylistById } from "./playlists";
import { useCdStore } from "../store/useCdStore";
import type { Artist } from "../types/artist";
import type { Playlist } from "../types/playlist";
import type { NavView } from "../store/useNavigationStore";

export type DetailReturnContext =
  | { kind: "sidebar"; view: NavView }
  | { kind: "album"; albumKey: string; title: string }
  | { kind: "artist"; artistKey: string }
  | { kind: "playlist"; playlistId: number; title: string }
  | { kind: "cd"; driveId: string; title: string };

/** Album keys are `${title}\0${albumArtist}` — title is enough for back labels. */
export function albumTitleFromKey(albumKey: string): string {
  const separator = albumKey.indexOf("\0");
  if (separator === -1) return "Album";
  const title = albumKey.slice(0, separator).trim();
  return title || "Album";
}

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
  const rawDisc = cdState.discsByDriveId[driveId];
  if (rawDisc == null) return cdSidebarDiscLabel(null);
  const remoteMetadata = cdState.metadataByDriveId[driveId] ?? null;
  return cdSidebarDiscLabel(
    remoteMetadata != null
      ? mergeRemoteMetadataIntoDisc(rawDisc, remoteMetadata)
      : rawDisc,
  );
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
  if (state.albumKey != null) {
    return {
      kind: "album",
      albumKey: state.albumKey,
      title: albumTitleFromKey(state.albumKey),
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
    case "album":
      return ctx.title;
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
    case "album":
      return {
        ...base,
        albumKey: ctx.albumKey,
        artistKey: null,
        playlistId: null,
        cdDriveId: null,
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
    case "album":
      return {
        ...base,
        albumKey: ctx.albumKey,
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
        albumKey: null,
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
        albumKey: null,
        cdDriveId: null,
      };
    case "cd":
      return {
        ...base,
        cdDriveId: ctx.driveId,
        albumKey: null,
        playlistId: null,
      };
    case "album":
      return {
        ...base,
        albumKey: ctx.albumKey,
        playlistId: null,
        cdDriveId: null,
      };
    case "artist":
      return {
        ...base,
        artistKey: ctx.artistKey,
        albumKey: null,
        playlistId: null,
        cdDriveId: null,
      };
    case "sidebar":
      return {
        ...base,
        albumKey: null,
        playlistId: null,
        cdDriveId: null,
        view: ctx.view,
      };
  }
}

export function stateAfterClosePlaylist(
  ctx: DetailReturnContext | null,
): Partial<NavigationSnapshot> {
  if (ctx?.kind === "sidebar") {
    return {
      playlistId: null,
      artistKey: null,
      cdDriveId: null,
      view: ctx.view,
    };
  }
  return { playlistId: null };
}

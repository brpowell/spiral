import { useMemo } from "react";
import type { Playlist } from "../../types/playlist";
import type { Track } from "../../types/track";
import { PlaylistArt } from "./PlaylistArt";

interface PlaylistContextMenuIconProps {
  playlist: Playlist;
  tracks: Track[];
}

/** Playlist cover sized for context menu rows (1rem). */
export function PlaylistContextMenuIcon({
  playlist,
  tracks,
}: PlaylistContextMenuIconProps) {
  return (
    <PlaylistArt
      playlist={playlist}
      tracks={tracks}
      className="playlist-art--menu"
      alt=""
    />
  );
}

/** Resolve playlist tracks once per menu open for reuse across items. */
export function usePlaylistTracksById(
  playlists: Playlist[],
  library: Track[],
): Map<number, Track[]> {
  return useMemo(() => {
    const byId = new Map(library.map((t) => [t.id, t]));
    return new Map(
      playlists.map((p) => [
        p.id,
        p.trackIds
          .map((id) => byId.get(id))
          .filter((t): t is Track => t != null),
      ]),
    );
  }, [playlists, library]);
}

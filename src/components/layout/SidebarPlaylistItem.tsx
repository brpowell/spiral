import { usePlaylistSidebarMenu } from "../../hooks/usePlaylistSidebarMenu";
import { resolvePlaylistTracks } from "../../lib/playlists";
import { useNavigationStore } from "../../store/useNavigationStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import type { Playlist } from "../../types/playlist";
import { PlaylistArt } from "../PlaylistArt/PlaylistArt";

interface SidebarPlaylistItemProps {
  playlist: Playlist;
}

export function SidebarPlaylistItem({ playlist }: SidebarPlaylistItemProps) {
  const playlistId = useNavigationStore((s) => s.playlistId);
  const openPlaylist = useNavigationStore((s) => s.openPlaylist);
  const library = usePlayerStore((s) => s.library);
  const { onContextMenu, contextMenu, deleteDialog } =
    usePlaylistSidebarMenu(playlist);

  const isActive = playlistId === playlist.id;
  const tracks = resolvePlaylistTracks(playlist, library);

  return (
    <li>
      <button
        type="button"
        className={
          isActive
            ? "sidebar__playlist-link sidebar__playlist-link--active"
            : "sidebar__playlist-link"
        }
        aria-current={isActive ? "page" : undefined}
        onClick={() => openPlaylist(playlist.id)}
        onContextMenu={onContextMenu}
      >
        <PlaylistArt
          playlist={playlist}
          tracks={tracks}
          className="playlist-art--sidebar"
          alt=""
        />
        <span className="sidebar__playlist-title">{playlist.title}</span>
      </button>
      {contextMenu}
      {deleteDialog}
    </li>
  );
}

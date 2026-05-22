import { usePlaylistSidebarMenu } from "../../hooks/usePlaylistSidebarMenu";
import { resolvePlaylistTracks } from "../../lib/playlists";
import { useNavigationStore } from "../../store/useNavigationStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import type { Playlist } from "../../types/playlist";
import { PlaylistArt } from "../PlaylistArt/PlaylistArt";
import { SidebarItem } from "./SidebarItem/SidebarItem";

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
      <SidebarItem
        variant="playlist"
        active={isActive}
        leading={
          <PlaylistArt
            playlist={playlist}
            tracks={tracks}
            className="playlist-art--sidebar"
            alt=""
          />
        }
        onClick={() => openPlaylist(playlist.id)}
        onContextMenu={onContextMenu}
      >
        {playlist.title}
      </SidebarItem>
      {contextMenu}
      {deleteDialog}
    </li>
  );
}

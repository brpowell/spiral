import { useSortable } from "@dnd-kit/react/sortable";
import { usePlaylistSidebarMenu } from "../../hooks/usePlaylistSidebarMenu";
import { resolvePlaylistTracks } from "../../lib/playlists";
import { useNavigationStore } from "../../store/useNavigationStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import type { Playlist } from "../../types/playlist";
import { PlaylistArt } from "../PlaylistArt/PlaylistArt";
import { SidebarItem } from "./SidebarItem/SidebarItem";

interface SidebarPlaylistItemProps {
  playlist: Playlist;
  index: number;
}

export function SidebarPlaylistItem({
  playlist,
  index,
}: SidebarPlaylistItemProps) {
  const playlistId = useNavigationStore((s) => s.playlistId);
  const openPlaylist = useNavigationStore((s) => s.openPlaylist);
  const library = usePlayerStore((s) => s.library);
  const { onContextMenu, contextMenu, deleteDialog } =
    usePlaylistSidebarMenu(playlist);
  // Keep the sortable element on the <li>, but activate drag from the
  // button so keyboard users get a single tab stop (not li + button).
  const { ref, handleRef, isDragging } = useSortable({
    id: playlist.id,
    index,
    group: "sidebar-playlists",
  });

  const isActive = playlistId === playlist.id;
  const tracks = resolvePlaylistTracks(playlist, library);

  return (
    <li
      ref={ref}
      className={[
        "sidebar__playlist-item",
        isDragging && "sidebar__playlist-item--dragging",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <SidebarItem
        ref={handleRef}
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

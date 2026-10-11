import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { DeletePlaylistDialog } from "../components/DeletePlaylistDialog/DeletePlaylistDialog";
import { useNavigationStore } from "../store/useNavigationStore";
import { usePlaylistStore } from "../store/usePlaylistStore";
import type { Playlist } from "../types/playlist";

export function useDeletePlaylistDialog(playlist: Playlist) {
  const [open, setOpen] = useState(false);
  const deletePlaylist = usePlaylistStore((s) => s.deletePlaylist);
  const closePlaylist = useNavigationStore((s) => s.closePlaylist);
  const navPlaylistId = useNavigationStore((s) => s.playlistId);

  const requestDelete = useCallback(() => {
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  const handleConfirm = useCallback(async () => {
    await deletePlaylist(playlist.id);
    if (navPlaylistId === playlist.id) {
      closePlaylist();
    }
  }, [closePlaylist, deletePlaylist, navPlaylistId, playlist.id]);

  const deleteDialog = createPortal(
    <DeletePlaylistDialog
      open={open}
      playlist={playlist}
      onClose={handleClose}
      onConfirm={handleConfirm}
    />,
    document.body,
  );

  return { requestDelete, deleteDialog };
}

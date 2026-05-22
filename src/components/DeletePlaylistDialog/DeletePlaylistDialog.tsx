import type { Playlist } from "../../types/playlist";
import { AlertConfirmation } from "../common/AlertConfirmation/AlertConfirmation";

interface DeletePlaylistDialogProps {
  open: boolean;
  playlist: Playlist;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function DeletePlaylistDialog({
  open,
  playlist,
  onClose,
  onConfirm,
}: DeletePlaylistDialogProps) {
  return (
    <AlertConfirmation
      open={open}
      onClose={onClose}
      title="Delete playlist?"
      titleId="delete-playlist-title"
      confirmLabel="Delete playlist"
      onConfirm={onConfirm}
    >
      <p>
        <strong>{playlist.title}</strong> will be permanently deleted. Tracks in this
        playlist will stay in your library.
      </p>
    </AlertConfirmation>
  );
}

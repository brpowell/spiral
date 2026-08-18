import { Trans, useTranslation } from "react-i18next";
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
  const { t } = useTranslation("dialogs");
  return (
    <AlertConfirmation
      open={open}
      onClose={onClose}
      title={t("deletePlaylist.title")}
      titleId="delete-playlist-title"
      confirmLabel={t("deletePlaylist.confirm")}
      onConfirm={onConfirm}
    >
      <p>
        <Trans
          i18nKey="deletePlaylist.body"
          values={{ title: playlist.title }}
          components={{ strong: <strong /> }}
        />
      </p>
    </AlertConfirmation>
  );
}

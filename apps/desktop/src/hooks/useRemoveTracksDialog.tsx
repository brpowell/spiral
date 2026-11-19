import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { RemoveTrackDialog } from "@/components/RemoveTrackDialog/RemoveTrackDialog";
import { usePlayerStore } from "@/store/usePlayerStore";
import type { Track } from "@/types/track";

/**
 * Remove-from-library confirmation for a fixed set of tracks (an album's,
 * an artist's). Render `removeDialog` next to the menu that calls
 * `openRemoveDialog`.
 */
export function useRemoveTracksDialog(tracks: Track[], onRemoved?: () => void) {
  const removeTracksFromLibrary = usePlayerStore(
    (s) => s.removeTracksFromLibrary,
  );
  const [open, setOpen] = useState(false);

  const openRemoveDialog = useCallback(() => setOpen(true), []);

  const removeDialog = open
    ? createPortal(
        <RemoveTrackDialog
          open={open}
          tracks={tracks}
          onClose={() => setOpen(false)}
          onRemove={async (deleteFromDisk) => {
            await removeTracksFromLibrary(
              tracks.map((track) => track.id),
              deleteFromDisk,
            );
            onRemoved?.();
          }}
        />,
        document.body,
      )
    : null;

  return { openRemoveDialog, removeDialog };
}

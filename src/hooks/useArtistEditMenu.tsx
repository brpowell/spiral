import { useMemo } from "react";
import {
  ContextMenu,
  ContextMenuItem,
} from "../components/ContextMenu/ContextMenu";
import { IconAddToQueue, IconPencil } from "../components/icons";
import { t } from "../lib/i18n";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Artist } from "../types/artist";
import type { ArtistBrowseMode } from "../lib/artists";
import { useContextMenu } from "./useContextMenu";

export function useArtistEditMenu(
  artist: Artist,
  browseMode: ArtistBrowseMode,
) {
  const openArtistEditor = usePlayerStore((s) => s.openArtistEditor);
  const addToQueue = usePlayerStore((s) => s.addToQueue);

  const trackIds = useMemo(
    () => artist.tracks.map((t) => t.id),
    [artist.tracks],
  );

  const trackCount = trackIds.length;

  const { onContextMenu, closeMenu, open, anchor, position, menuRef } =
    useContextMenu({
      layoutDeps: [trackCount],
    });

  const contextMenu = (
    <ContextMenu
      open={open}
      anchor={anchor}
      position={position}
      menuRef={menuRef}
    >
      <ContextMenuItem
        icon={<IconPencil />}
        label={t("library:actions.editArtist")}
        onClick={() => {
          closeMenu();
          openArtistEditor(artist.key, browseMode);
        }}
      />
      {trackCount > 0 ? (
        <ContextMenuItem
          icon={<IconAddToQueue />}
          label={t("library:actions.addToQueue", { count: trackCount })}
          onClick={() => {
            closeMenu();
            addToQueue(trackIds);
          }}
        />
      ) : null}
    </ContextMenu>
  );

  return { onContextMenu, contextMenu };
}

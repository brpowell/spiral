import { useMemo } from "react";
import {
  ContextMenu,
  ContextMenuItem,
} from "@/components/ContextMenu/ContextMenu";
import { IconAddToQueue, IconPencil, IconPlay } from "@/components/icons";
import { t } from "@/lib/i18n/i18n";
import type { Genre } from "@/lib/genres/genres";
import { usePlayerStore } from "@/store/usePlayerStore";
import { useContextMenu } from "./useContextMenu";

export function useGenreEditMenu(genre: Genre) {
  const openGenreEditor = usePlayerStore((s) => s.openGenreEditor);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const playTracks = usePlayerStore((s) => s.playTracks);

  const trackIds = useMemo(
    () => genre.tracks.map((track) => track.id),
    [genre.tracks],
  );
  const trackCount = trackIds.length;

  const { onContextMenu, closeMenu, open, anchor, position, menuRef } =
    useContextMenu({ layoutDeps: [trackCount] });

  const contextMenu = (
    <ContextMenu
      open={open}
      anchor={anchor}
      position={position}
      menuRef={menuRef}
    >
      <ContextMenuItem
        icon={<IconPencil />}
        label={t("library:actions.editGenre")}
        onClick={() => {
          closeMenu();
          openGenreEditor(genre.key);
        }}
      />
      {trackCount > 0 ? (
        <ContextMenuItem
          icon={<IconPlay />}
          label={t("library:actions.playAll")}
          onClick={() => {
            closeMenu();
            void playTracks(trackIds, trackIds[0]);
          }}
        />
      ) : null}
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

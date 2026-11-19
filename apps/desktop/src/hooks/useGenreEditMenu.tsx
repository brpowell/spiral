import { useMemo, useRef } from "react";
import { AddToPlaylistSubmenu } from "@/components/AddToPlaylistSubmenu/AddToPlaylistSubmenu";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ContextMenu/ContextMenu";
import {
  IconAddToQueue,
  IconConvert,
  IconPencil,
  IconPlay,
  IconRemoveFromQueue,
} from "@/components/icons";
import { openConvertForTrackIds } from "@/lib/files/convertTracks";
import { isTrackConvertible } from "@/lib/import/pendingImportTrack";
import { t } from "@/lib/i18n/i18n";
import type { Genre } from "@/lib/genres/genres";
import { usePlayerStore } from "@/store/usePlayerStore";
import { useContextMenu } from "./useContextMenu";

export function useGenreEditMenu(genre: Genre) {
  const openGenreEditor = usePlayerStore((s) => s.openGenreEditor);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const manualQueueIds = usePlayerStore((s) => s.manualQueueIds);
  const playTracks = usePlayerStore((s) => s.playTracks);

  const trackIds = useMemo(
    () => genre.tracks.map((track) => track.id),
    [genre.tracks],
  );
  const trackCount = trackIds.length;
  const anyInQueue = trackIds.some((id) => manualQueueIds.includes(id));
  const convertibleCount = genre.tracks.filter((track) =>
    isTrackConvertible(track),
  ).length;
  const submenuPanelRef = useRef<HTMLDivElement>(null);

  const { onContextMenu, closeMenu, open, anchor, position, menuRef } =
    useContextMenu({
      layoutDeps: [trackCount, anyInQueue, convertibleCount],
      dismissExcludeRefs: [submenuPanelRef],
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
        label={t("library:actions.editGenre")}
        onClick={() => {
          closeMenu();
          openGenreEditor(genre.key);
        }}
      />
      {trackCount > 0 ? <ContextMenuSeparator /> : null}
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
      {anyInQueue ? (
        <ContextMenuItem
          icon={<IconRemoveFromQueue />}
          label={t("library:actions.removeFromQueue", { count: trackCount })}
          onClick={() => {
            closeMenu();
            for (const id of trackIds) {
              if (manualQueueIds.includes(id)) removeFromQueue(id);
            }
          }}
        />
      ) : null}
      {trackCount > 0 ? <ContextMenuSeparator /> : null}
      {trackCount > 0 ? (
        <AddToPlaylistSubmenu
          trackIds={trackIds}
          closeMenu={closeMenu}
          panelRef={submenuPanelRef}
        />
      ) : null}
      {convertibleCount > 0 ? (
        <ContextMenuItem
          icon={<IconConvert />}
          label={t("library:actions.convert", { count: convertibleCount })}
          onClick={() => {
            closeMenu();
            openConvertForTrackIds(trackIds);
          }}
        />
      ) : null}
    </ContextMenu>
  );

  return { onContextMenu, contextMenu };
}

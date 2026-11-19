import { useCallback, useMemo, useRef } from "react";
import { AddToPlaylistSubmenu } from "@/components/AddToPlaylistSubmenu/AddToPlaylistSubmenu";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ContextMenu/ContextMenu";
import {
  IconAddToQueue,
  IconConvert,
  IconDelete,
  IconPencil,
  IconPlay,
  IconRemoveFromQueue,
} from "@/components/icons";
import { openConvertForTrackIds } from "@/lib/files/convertTracks";
import { t } from "@/lib/i18n/i18n";
import { isTrackConvertible } from "@/lib/import/pendingImportTrack";
import { usePlayerStore } from "@/store/usePlayerStore";
import type { Album } from "@/types/album";
import { useContextMenu } from "./useContextMenu";
import { useRemoveTracksDialog } from "./useRemoveTracksDialog";

export function useAlbumEditMenu(album: Album) {
  const manualQueueIds = usePlayerStore((s) => s.manualQueueIds);
  const openAlbumEditor = usePlayerStore((s) => s.openAlbumEditor);
  const playTracks = usePlayerStore((s) => s.playTracks);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);

  const albumTrackIds = useMemo(
    () => album.tracks.map((t) => t.id),
    [album.tracks],
  );

  const anyInQueue = albumTrackIds.some((id) => manualQueueIds.includes(id));
  const trackCount = album.tracks.length;
  const convertibleCount = album.tracks.filter((track) =>
    isTrackConvertible(track),
  ).length;

  const { openRemoveDialog, removeDialog } = useRemoveTracksDialog(
    album.tracks,
  );
  const submenuPanelRef = useRef<HTMLDivElement>(null);
  const { onContextMenu, closeMenu, open, anchor, position, menuRef } =
    useContextMenu({
      layoutDeps: [anyInQueue, trackCount, convertibleCount],
      dismissExcludeRefs: [submenuPanelRef],
    });

  const openEditor = useCallback(() => {
    closeMenu();
    openAlbumEditor(album.key);
  }, [closeMenu, openAlbumEditor, album.key]);

  const contextMenu = (
    <>
      <ContextMenu
        open={open}
        anchor={anchor}
        position={position}
        menuRef={menuRef}
      >
        <ContextMenuItem
          icon={<IconPencil />}
          label={t("library:actions.editAlbum")}
          onClick={openEditor}
        />
        {trackCount > 0 ? <ContextMenuSeparator /> : null}
        {trackCount > 0 ? (
          <ContextMenuItem
            icon={<IconPlay />}
            label={t("library:actions.playAll")}
            onClick={() => {
              closeMenu();
              void playTracks(albumTrackIds, albumTrackIds[0]);
            }}
          />
        ) : null}
        {trackCount > 0 ? (
          <ContextMenuItem
            icon={<IconAddToQueue />}
            label={t("library:actions.addToQueue", { count: trackCount })}
            onClick={() => {
              closeMenu();
              addToQueue(albumTrackIds);
            }}
          />
        ) : null}
        {anyInQueue ? (
          <ContextMenuItem
            icon={<IconRemoveFromQueue />}
            label={t("library:actions.removeFromQueue", { count: trackCount })}
            onClick={() => {
              closeMenu();
              for (const id of albumTrackIds) {
                if (manualQueueIds.includes(id)) removeFromQueue(id);
              }
            }}
          />
        ) : null}
        {trackCount > 0 ? <ContextMenuSeparator /> : null}
        {trackCount > 0 ? (
          <AddToPlaylistSubmenu
            trackIds={albumTrackIds}
            closeMenu={closeMenu}
            panelRef={submenuPanelRef}
          />
        ) : null}
        {convertibleCount > 0 ? (
          <ContextMenuItem
            icon={<IconConvert />}
            label={t("library:actions.convertAlbum", {
              count: convertibleCount,
            })}
            onClick={() => {
              closeMenu();
              openConvertForTrackIds(albumTrackIds);
            }}
          />
        ) : null}
        {trackCount > 0 ? <ContextMenuSeparator /> : null}
        {trackCount > 0 ? (
          <ContextMenuItem
            icon={<IconDelete />}
            label={t("library:actions.removeFromLibrary", {
              count: trackCount,
            })}
            className="context-menu__danger"
            onClick={() => {
              closeMenu();
              openRemoveDialog();
            }}
          />
        ) : null}
      </ContextMenu>
      {removeDialog}
    </>
  );

  return { onContextMenu, openEditor, contextMenu };
}

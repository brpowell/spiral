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
  IconDelete,
  IconPencil,
  IconPlay,
  IconRemoveFromQueue,
} from "@/components/icons";
import { openConvertForTrackIds } from "@/lib/files/convertTracks";
import { isTrackConvertible } from "@/lib/import/pendingImportTrack";
import { t } from "@/lib/i18n/i18n";
import { usePlayerStore } from "@/store/usePlayerStore";
import type { Artist } from "@/types/artist";
import type { ArtistBrowseMode } from "@/lib/artists/artists";
import { useContextMenu } from "./useContextMenu";
import { useRemoveTracksDialog } from "./useRemoveTracksDialog";

export function useArtistEditMenu(
  artist: Artist,
  browseMode: ArtistBrowseMode,
) {
  const openArtistEditor = usePlayerStore((s) => s.openArtistEditor);
  const playTracks = usePlayerStore((s) => s.playTracks);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const manualQueueIds = usePlayerStore((s) => s.manualQueueIds);

  const trackIds = useMemo(
    () => artist.tracks.map((t) => t.id),
    [artist.tracks],
  );

  const trackCount = trackIds.length;
  const anyInQueue = trackIds.some((id) => manualQueueIds.includes(id));
  const convertibleCount = artist.tracks.filter((track) =>
    isTrackConvertible(track),
  ).length;
  const { openRemoveDialog, removeDialog } = useRemoveTracksDialog(
    artist.tracks,
  );
  const submenuPanelRef = useRef<HTMLDivElement>(null);

  const { onContextMenu, closeMenu, open, anchor, position, menuRef } =
    useContextMenu({
      layoutDeps: [trackCount, anyInQueue, convertibleCount],
      dismissExcludeRefs: [submenuPanelRef],
    });

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
          label={t("library:actions.editArtist")}
          onClick={() => {
            closeMenu();
            openArtistEditor(artist.key, browseMode);
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

  return { onContextMenu, contextMenu };
}

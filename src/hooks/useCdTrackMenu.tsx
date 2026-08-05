import { useCallback, useMemo } from "react";
import {
  ContextMenu,
  ContextMenuItem,
} from "../components/ContextMenu/ContextMenu";
import { IconAddToQueue, IconInfo } from "../components/icons";
import { t } from "../lib/i18n";
import { tracksForContextAction } from "../lib/trackSelection";
import { useCdStore } from "../store/useCdStore";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track } from "../types/track";
import { useCdImportBlockingPlayback } from "./useCdImportBlockingPlayback";
import { useContextMenu } from "./useContextMenu";

interface UseCdTrackMenuOptions {
  driveId: string;
  tracks: Track[];
}

export function useCdTrackMenu(
  track: Track,
  { driveId, tracks }: UseCdTrackMenuOptions,
) {
  const selectedTrackIds = usePlayerStore((s) => s.selectedTrackIds);
  const addCdToQueue = usePlayerStore((s) => s.addCdToQueue);
  const selectTracksInList = usePlayerStore((s) => s.selectTracksInList);
  const openCdTrackEditor = useCdStore((s) => s.openCdTrackEditor);
  const cdImportBlockingPlayback = useCdImportBlockingPlayback(driveId);

  const cdTrackIdSet = useMemo(
    () => new Set(tracks.map((row) => row.id)),
    [tracks],
  );

  const contextTrackIds = useMemo(
    () => tracksForContextAction(track.id, selectedTrackIds, cdTrackIdSet),
    [track.id, selectedTrackIds, cdTrackIdSet],
  );

  const contextTracks = useMemo(
    () =>
      contextTrackIds
        .map((id) => tracks.find((row) => row.id === id))
        .filter((row): row is Track => row != null),
    [contextTrackIds, tracks],
  );

  const bulkAdd = contextTracks.length > 1;

  const onBeforeOpen = useCallback(() => {
    if (!selectedTrackIds.includes(track.id)) {
      selectTracksInList(
        track.id,
        tracks.map((row) => row.id),
        {
          shiftKey: false,
          metaKey: false,
        },
      );
    }
  }, [selectTracksInList, selectedTrackIds, track.id, tracks]);

  const { onContextMenu, closeMenu, open, anchor, position, menuRef } =
    useContextMenu({
      layoutDeps: [bulkAdd, contextTracks.length, cdImportBlockingPlayback],
      onBeforeOpen,
    });

  const handleAddToQueue = useCallback(() => {
    closeMenu();
    addCdToQueue(driveId, contextTracks);
  }, [addCdToQueue, closeMenu, contextTracks, driveId]);

  const handleOpenEditor = useCallback(() => {
    closeMenu();
    openCdTrackEditor(driveId, contextTrackIds);
  }, [closeMenu, contextTrackIds, driveId, openCdTrackEditor]);

  const contextMenu = open ? (
    <ContextMenu
      open={open}
      anchor={anchor}
      position={position}
      menuRef={menuRef}
    >
      <ContextMenuItem
        icon={<IconInfo />}
        label={
          bulkAdd
            ? t("library:cd.actions.viewDetailsBulk", {
                count: contextTracks.length,
              })
            : t("library:cd.actions.viewDetails")
        }
        onClick={handleOpenEditor}
      />
      <ContextMenuItem
        icon={<IconAddToQueue />}
        label={
          bulkAdd
            ? t("library:cd.actions.addToQueueBulk", {
                count: contextTracks.length,
              })
            : t("library:cd.actions.addToQueue")
        }
        disabled={cdImportBlockingPlayback}
        onClick={handleAddToQueue}
      />
    </ContextMenu>
  ) : null;

  return { onContextMenu, contextMenu };
}

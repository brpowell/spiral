import { useCallback, useMemo } from "react";
import {
  ContextMenu,
  ContextMenuItem,
} from "../components/ContextMenu/ContextMenu";
import { IconAddToQueue } from "../components/icons";
import { tracksForContextAction } from "../lib/trackSelection";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track } from "../types/track";
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
      selectTracksInList(track.id, tracks.map((row) => row.id), {
        shiftKey: false,
        metaKey: false,
      });
    }
  }, [selectTracksInList, selectedTrackIds, track.id, tracks]);

  const { onContextMenu, closeMenu, open, anchor, position, menuRef } =
    useContextMenu({
      layoutDeps: [bulkAdd, contextTracks.length],
      onBeforeOpen,
    });

  const handleAddToQueue = useCallback(() => {
    closeMenu();
    addCdToQueue(driveId, contextTracks);
  }, [addCdToQueue, closeMenu, contextTracks, driveId]);

  const contextMenu = open ? (
    <ContextMenu
      open={open}
      anchor={anchor}
      position={position}
      menuRef={menuRef}
    >
      <ContextMenuItem
        icon={<IconAddToQueue />}
        label={
          bulkAdd
            ? `Add ${contextTracks.length} to Queue`
            : "Add to Queue"
        }
        onClick={handleAddToQueue}
      />
    </ContextMenu>
  ) : null;

  return { onContextMenu, contextMenu };
}

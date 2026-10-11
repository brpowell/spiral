import { useCallback, useState } from "react";
import type { TrackListColumnId } from "./types";

const DRAG_THRESHOLD_PX = 5;

interface UseTrackListColumnReorderOptions {
  indexColumn: TrackListColumnId;
  enabled: boolean;
  onReorder: (fromId: TrackListColumnId, toId: TrackListColumnId) => void;
}

export function useTrackListColumnReorder({
  indexColumn,
  enabled,
  onReorder,
}: UseTrackListColumnReorderOptions) {
  const [draggingColumnId, setDraggingColumnId] =
    useState<TrackListColumnId | null>(null);
  const [dragOverColumnId, setDragOverColumnId] =
    useState<TrackListColumnId | null>(null);

  const findColumnAt = useCallback(
    (clientX: number, clientY: number): TrackListColumnId | null => {
      const target = document.elementFromPoint(clientX, clientY);
      const cell = target?.closest("[data-track-list-col]");
      if (!cell) return null;
      return cell.getAttribute("data-track-list-col") as TrackListColumnId | null;
    },
    [],
  );

  const isValidDropTarget = useCallback(
    (columnId: TrackListColumnId | null): columnId is TrackListColumnId =>
      columnId != null &&
      columnId !== indexColumn &&
      columnId !== "check",
    [indexColumn],
  );

  const startColumnReorder = useCallback(
    (
      e: React.PointerEvent,
      columnId: TrackListColumnId,
      onTap?: () => void,
    ) => {
      if (!enabled || columnId === indexColumn) return;
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest(".track-list__resize-handle")) {
        return;
      }

      const originX = e.clientX;
      const originY = e.clientY;
      let started = false;

      const onMove = (ev: PointerEvent) => {
        if (!started) {
          const dx = ev.clientX - originX;
          const dy = ev.clientY - originY;
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          started = true;
          setDraggingColumnId(columnId);
        }
        const overId = findColumnAt(ev.clientX, ev.clientY);
        setDragOverColumnId(isValidDropTarget(overId) ? overId : null);
      };

      const onUp = (ev: PointerEvent) => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        if (started) {
          const toId = findColumnAt(ev.clientX, ev.clientY);
          if (isValidDropTarget(toId) && toId !== columnId) {
            onReorder(columnId, toId);
          }
        } else if (ev.button === 0) {
          onTap?.();
        }
        setDraggingColumnId(null);
        setDragOverColumnId(null);
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [enabled, findColumnAt, indexColumn, isValidDropTarget, onReorder],
  );

  return {
    draggingColumnId,
    dragOverColumnId,
    startColumnReorder,
  };
}

import { useCallback, useMemo, useState } from "react";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuHeading,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../ContextMenu/ContextMenu";
import { IconHide } from "../icons";
import { useContextMenu } from "../../hooks/useContextMenu";
import type { TrackListColumnDef, TrackListColumnId } from "./types";

interface UseTrackListHeaderMenuOptions {
  hideableColumns: TrackListColumnDef[];
  isColumnVisible: (id: TrackListColumnId) => boolean;
  onToggle: (id: TrackListColumnId) => void;
  onHide: (id: TrackListColumnId) => void;
}

export function useTrackListHeaderMenu({
  hideableColumns,
  isColumnVisible,
  onToggle,
  onHide,
}: UseTrackListHeaderMenuOptions) {
  const [targetColumn, setTargetColumn] = useState<TrackListColumnDef | null>(
    null,
  );

  const otherColumns = useMemo(
    () =>
      targetColumn
        ? hideableColumns.filter((col) => col.id !== targetColumn.id)
        : hideableColumns,
    [hideableColumns, targetColumn],
  );

  const visibilityKey = otherColumns
    .map((col) => (isColumnVisible(col.id) ? "1" : "0"))
    .join("");

  const { open, anchor, position, menuRef, closeMenu, openAt } = useContextMenu({
    layoutDeps: [targetColumn?.id, otherColumns.length, visibilityKey],
  });

  const onHeaderContextMenu = useCallback(
    (col: TrackListColumnDef) => (e: React.MouseEvent) => {
      if (hideableColumns.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      setTargetColumn(col);
      openAt(e.clientX, e.clientY);
    },
    [hideableColumns.length, openAt],
  );

  const showHide = targetColumn?.hideable === true;
  const showOtherColumns = otherColumns.length > 0;

  const contextMenu =
    hideableColumns.length > 0 ? (
      <ContextMenu
        open={open}
        anchor={anchor}
        position={position}
        menuRef={menuRef}
      >
        {showHide ? (
          <ContextMenuItem
            icon={<IconHide />}
            label={`Hide ${targetColumn!.label}`}
            onClick={() => {
              closeMenu();
              onHide(targetColumn!.id);
            }}
          />
        ) : null}
        {showOtherColumns ? (
          <>
            {showHide ? <ContextMenuSeparator /> : null}
            <ContextMenuHeading>Columns</ContextMenuHeading>
          </>
        ) : null}
        {otherColumns.map((col) => (
          <ContextMenuCheckboxItem
            key={col.id}
            checked={isColumnVisible(col.id)}
            label={col.label}
            onClick={() => onToggle(col.id)}
          />
        ))}
      </ContextMenu>
    ) : null;

  return { onHeaderContextMenu, contextMenu };
}

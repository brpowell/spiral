import { useRef } from "react";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuHeading,
} from "../ContextMenu/ContextMenu";
import { Button } from "../Button/Button";
import { IconColumns } from "../icons";
import { useContextMenu } from "../../hooks/useContextMenu";
import type { TrackListColumnDef, TrackListColumnId } from "./types";
import "./TrackListColumnMenu.css";

interface TrackListColumnMenuProps {
  columns: TrackListColumnDef[];
  isColumnVisible: (id: TrackListColumnId) => boolean;
  onToggle: (id: TrackListColumnId) => void;
}

export function TrackListColumnMenu({
  columns,
  isColumnVisible,
  onToggle,
}: TrackListColumnMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { open, anchor, position, menuRef, toggleFromTrigger } = useContextMenu({
    layoutDeps: [columns.length],
    dismissExcludeRefs: [triggerRef],
  });

  if (columns.length === 0) return null;

  return (
    <div className="track-list-column-menu">
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        iconOnly
        className="track-list-column-menu__trigger"
        aria-label="Show or hide columns"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => toggleFromTrigger(triggerRef.current)}
      >
        <IconColumns />
      </Button>
      <ContextMenu
        open={open}
        anchor={anchor}
        position={position}
        menuRef={menuRef}
      >
        <ContextMenuHeading>Columns</ContextMenuHeading>
        {columns.map((col) => (
          <ContextMenuCheckboxItem
            key={col.id}
            checked={isColumnVisible(col.id)}
            label={col.label}
            onClick={() => onToggle(col.id)}
          />
        ))}
      </ContextMenu>
    </div>
  );
}

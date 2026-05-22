import {
  ContextMenuCheckboxItem,
  ContextMenuHeading,
} from "../ContextMenu/ContextMenu";
import { IconColumns } from "../icons";
import { MenuButton } from "../MenuButton/MenuButton";
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
  if (columns.length === 0) return null;

  return (
    <MenuButton
      ariaLabel="Show or hide columns"
      icon={<IconColumns />}
      className="track-list-column-menu"
      triggerClassName="track-list-column-menu__trigger"
      layoutDeps={[columns.length]}
    >
      <>
        <ContextMenuHeading>Columns</ContextMenuHeading>
        {columns.map((col) => (
          <ContextMenuCheckboxItem
            key={col.id}
            checked={isColumnVisible(col.id)}
            label={col.label}
            onClick={() => onToggle(col.id)}
          />
        ))}
      </>
    </MenuButton>
  );
}

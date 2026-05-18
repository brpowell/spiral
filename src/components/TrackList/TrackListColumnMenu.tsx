import { useEffect, useRef, useState } from "react";
import { IconCheck, IconColumns } from "../icons";
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
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (columns.length === 0) return null;

  return (
    <div className="track-list-column-menu" ref={rootRef}>
      <button
        type="button"
        className="track-list-column-menu__trigger"
        aria-label="Show or hide columns"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
      >
        <IconColumns />
      </button>
      {open ? (
        <div className="track-list-column-menu__panel" role="menu">
          <p className="track-list-column-menu__heading">Columns</p>
          <ul className="track-list-column-menu__list">
            {columns.map((col) => {
              const visible = isColumnVisible(col.id);
              return (
                <li key={col.id}>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={visible}
                    className="track-list-column-menu__item"
                    onClick={() => onToggle(col.id)}
                  >
                    <span
                      className="track-list-column-menu__check"
                      aria-hidden
                    >
                      {visible ? <IconCheck /> : null}
                    </span>
                    {col.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

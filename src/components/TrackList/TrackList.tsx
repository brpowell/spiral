import { useCallback, type CSSProperties, type ReactNode } from "react";
import { formatDateAdded, formatTime } from "../../lib/format";
import { PlayingIndicator } from "../PlayingIndicator/PlayingIndicator";
import { TrackRowMenu } from "../TrackRowMenu/TrackRowMenu";
import { TrackListColumnMenu } from "./TrackListColumnMenu";
import { useTrackListColumns } from "./useTrackListColumns";
import {
  DEFAULT_COLUMN_WIDTHS,
  type TrackListColumnDef,
  type TrackListColumnId,
  type TrackListPresetId,
  type TrackListSortDir,
  type TrackListSortField,
} from "./types";
import type { Track } from "../../types/track";
import "../TrackRowMenu/TrackRowMenu.css";
import "./TrackList.css";

function cellValue(track: Track, columnId: TrackListColumnId): ReactNode {
  switch (columnId) {
    case "title":
      return track.title;
    case "artist":
      return track.artist ?? "—";
    case "album":
      return track.album ?? "—";
    case "albumArtist":
      return track.albumArtist ?? "—";
    case "duration":
      return track.durationSeconds != null
        ? formatTime(track.durationSeconds)
        : "—";
    case "year":
      return track.year != null ? String(track.year) : "—";
    case "genre":
      return track.genre ?? "—";
    case "discNumber":
      return track.discNumber != null ? String(track.discNumber) : "—";
    case "dateAdded":
      return formatDateAdded(track.dateAdded);
    case "playCount":
      return String(track.playCount);
    default:
      return "—";
  }
}

function indexDisplay(
  track: Track,
  displayIndex: number,
  indexColumn: "index" | "trackNumber",
): string {
  if (indexColumn === "trackNumber") {
    return track.trackNumber != null ? String(track.trackNumber) : "—";
  }
  return String(displayIndex + 1);
}

function sortFieldForColumn(
  col: TrackListColumnDef,
  indexColumn: "index" | "trackNumber",
): TrackListSortField | null {
  if (!col.sortable) return null;
  if (col.id === indexColumn) return "index";
  return col.id as TrackListSortField;
}

interface TrackListProps {
  presetId: TrackListPresetId;
  tracks: Track[];
  selectedTrackIds: number[];
  currentTrackId: number | null;
  playbackState: "playing" | "paused" | "stopped";
  onSelectTrack: (track: Track, e: React.MouseEvent) => void;
  onPlayTrack: (track: Track) => void;
  sortField?: TrackListSortField;
  sortDir?: TrackListSortDir;
  onSort?: (field: TrackListSortField) => void;
  emptyMessage?: string;
  className?: string;
  bordered?: boolean;
}

interface ResizeHandleProps {
  columnId: TrackListColumnId;
  startWidth: number;
  onResize: (columnId: TrackListColumnId, width: number) => void;
  onResizeEnd: () => void;
}

function ResizeHandle({
  columnId,
  startWidth,
  onResize,
  onResizeEnd,
}: ResizeHandleProps) {
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const originX = e.clientX;
      const originWidth = startWidth;

      const onMove = (ev: PointerEvent) => {
        onResize(columnId, originWidth + ev.clientX - originX);
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        onResizeEnd();
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [columnId, onResize, onResizeEnd, startWidth],
  );

  return (
    <span
      className="track-list__resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      onPointerDown={onPointerDown}
    />
  );
}

export function TrackList({
  presetId,
  tracks,
  selectedTrackIds,
  currentTrackId,
  playbackState,
  onSelectTrack,
  onPlayTrack,
  sortField,
  sortDir,
  onSort,
  emptyMessage = "No tracks.",
  className = "",
  bordered = true,
}: TrackListProps) {
  const {
    preset,
    visibleColumns,
    hideableColumns,
    gridTemplateColumns,
    minTableWidth,
    columnWidths,
    setColumnWidth,
    toggleColumnVisibility,
    isColumnVisible,
    flushSave,
  } = useTrackListColumns(presetId);

  const gridStyle = {
    "--track-list-columns": gridTemplateColumns,
    "--track-list-min-width": `${minTableWidth}px`,
  } as CSSProperties;

  const sortIndicator = (field: TrackListSortField) => {
    if (!sortField || field !== sortField) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  };

  const renderHeaderCell = (col: TrackListColumnDef) => {
    const field = sortFieldForColumn(col, preset.indexColumn);
    const label = `${col.label}${field && onSort ? sortIndicator(field) : ""}`;

    const content =
      onSort && field ? (
        <button
          type="button"
          className="track-list__header-btn"
          onClick={() => onSort(field)}
        >
          {label}
        </button>
      ) : (
        <span className="track-list__header-label">{label}</span>
      );

    const width =
      columnWidths[col.id] ?? DEFAULT_COLUMN_WIDTHS[col.id] ?? 80;

    return (
      <div
        key={col.id}
        className={[
          "track-list__header-cell",
          col.resizable && "track-list__header-cell--resizable",
          col.align === "center" && "track-list__cell--center",
          col.align === "right" && "track-list__cell--right",
        ]
          .filter(Boolean)
          .join(" ")}
        data-track-list-col={col.id}
      >
        {content}
        {col.resizable ? (
          <ResizeHandle
            columnId={col.id}
            startWidth={width}
            onResize={setColumnWidth}
            onResizeEnd={flushSave}
          />
        ) : null}
      </div>
    );
  };

  return (
    <div
      className={[
        "track-list",
        bordered && "track-list--bordered",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="track-list__scroll">
        <div className="track-list__inner" style={gridStyle}>
          <div className="track-list__header" style={gridStyle} role="row">
            {visibleColumns.map(renderHeaderCell)}
            <div className="track-list__filler" aria-hidden />
            <div className="track-list__header-actions">
              {hideableColumns.length > 0 ? (
                <TrackListColumnMenu
                  columns={hideableColumns}
                  isColumnVisible={isColumnVisible}
                  onToggle={toggleColumnVisibility}
                />
              ) : null}
            </div>
          </div>

          {tracks.length === 0 ? (
            <p className="track-list__empty">{emptyMessage}</p>
          ) : (
            <ol className="track-list__body">
              {tracks.map((track, displayIndex) => {
            const isSelected = selectedTrackIds.includes(track.id);
            const isNowPlaying = track.id === currentTrackId;
            const isActivelyPlaying =
              isNowPlaying && playbackState === "playing";

            return (
              <li key={track.id} className="track-list__item">
                <TrackRowMenu track={track} className="track-list__row-wrap">
                  <div
                    role="button"
                    tabIndex={0}
                    className={[
                      "track-list__row",
                      isSelected && "track-list__row--selected",
                      isNowPlaying && "track-list__row--playing",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={gridStyle}
                    onClick={(e) => onSelectTrack(track, e)}
                    onDoubleClick={() => onPlayTrack(track)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onPlayTrack(track);
                    }}
                  >
                    {visibleColumns.map((col) => {
                      if (col.id === preset.indexColumn) {
                        return (
                          <span
                            key={col.id}
                            className={[
                              "track-list__cell",
                              "track-list__cell--index",
                              col.align === "center" &&
                                "track-list__cell--center",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            {indexDisplay(
                              track,
                              displayIndex,
                              preset.indexColumn,
                            )}
                          </span>
                        );
                      }

                      if (col.id === "title") {
                        return (
                          <span
                            key={col.id}
                            className={[
                              "track-list__cell",
                              "track-list__cell--title",
                              isActivelyPlaying &&
                                "track-list__cell--title-with-indicator",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            <PlayingIndicator active={isActivelyPlaying} />
                            <span className="track-list__title-text">
                              {track.title}
                            </span>
                          </span>
                        );
                      }

                      return (
                        <span
                          key={col.id}
                          className={[
                            "track-list__cell",
                            col.secondary && "track-list__cell--secondary",
                            col.align === "center" &&
                              "track-list__cell--center",
                            col.align === "right" && "track-list__cell--right",
                            col.id === "duration" &&
                              "track-list__cell--duration",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {cellValue(track, col.id)}
                        </span>
                      );
                    })}
                    <span className="track-list__cell track-list__filler" aria-hidden />
                    <span className="track-list__cell track-list__cell--actions" />
                  </div>
                </TrackRowMenu>
              </li>
            );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

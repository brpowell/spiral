import { memo, type CSSProperties, type ReactNode } from "react";
import { formatDateAdded, formatTime } from "../../lib/format";
import {
  isTrackImporting,
  isTrackInteractive,
} from "../../lib/pendingImportTrack";
import {
  hasNavigableAlbum,
  hasNavigableArtist,
  navigationAlbumKey,
  navigationArtistKey,
} from "../../lib/trackNavigation";
import { useNavigationStore } from "../../store/useNavigationStore";
import { IconGrip } from "../icons";
import { PlayingIndicator } from "../PlayingIndicator/PlayingIndicator";
import { TrackItemTitle } from "../TrackItemTitle/TrackItemTitle";
import { TrackRowMenu } from "../TrackRowMenu/TrackRowMenu";
import type { TrackListColumnDef, TrackListColumnId } from "./types";
import type { Track } from "../../types/track";

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
      if (isTrackImporting(track)) return "Importing…";
      return track.durationSeconds != null
        ? formatTime(track.durationSeconds)
        : "—";
    case "year":
      return track.year != null ? String(track.year) : "—";
    case "genre":
      return track.genre ?? "—";
    case "discNumber":
      return track.discNumber != null ? String(track.discNumber) : "—";
    case "trackNumber":
      return track.trackNumber != null ? String(track.trackNumber) : "—";
    case "dateAdded":
      return formatDateAdded(track.dateAdded);
    case "playCount":
      return String(track.playCount);
    default:
      return "—";
  }
}

interface TrackListCellLinkProps {
  label: string;
  ariaLabel: string;
  onClick: () => void;
}

function TrackListCellLink({ label, ariaLabel, onClick }: TrackListCellLinkProps) {
  return (
    <button
      type="button"
      className="track-list__cell-link"
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {label}
    </button>
  );
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

export interface TrackListRowProps {
  track: Track;
  displayIndex: number;
  showAlbumArt: boolean;
  visibleColumns: TrackListColumnDef[];
  indexColumn: "index" | "trackNumber";
  gridStyle: CSSProperties;
  canReorder: boolean;
  playlistId?: number;
  isSelected: boolean;
  isNowPlaying: boolean;
  isActivelyPlaying: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  onSelectTrack: (track: Track, e: React.MouseEvent) => void;
  onPlayTrack: (track: Track) => void;
  onStartReorder: (e: React.PointerEvent, fromIndex: number) => void;
}

function TrackListRowComponent({
  track,
  displayIndex,
  showAlbumArt,
  visibleColumns,
  indexColumn,
  gridStyle,
  canReorder,
  playlistId,
  isSelected,
  isNowPlaying,
  isActivelyPlaying,
  isDragging,
  isDragOver,
  onSelectTrack,
  onPlayTrack,
  onStartReorder,
}: TrackListRowProps) {
  const isImporting = isTrackImporting(track);
  const isInteractive = isTrackInteractive(track);
  const openAlbum = useNavigationStore((s) => s.openAlbum);
  const openArtist = useNavigationStore((s) => s.openArtist);
  const artistBrowseMode = useNavigationStore((s) => s.artistBrowseMode);

  return (
    <li
      data-track-list-index={displayIndex}
      className={[
        "track-list__item",
        isDragging && "track-list__item--dragging",
        isDragOver && "track-list__item--drag-over",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <TrackRowMenu
        track={track}
        className="track-list__row-wrap"
        playlistId={playlistId}
        interactive={isInteractive}
      >
        <div
          role={isInteractive ? "button" : "group"}
          tabIndex={isInteractive ? 0 : -1}
          aria-disabled={isImporting || undefined}
          className={[
            "track-list__row",
            showAlbumArt && "track-list__row--with-art",
            isSelected && "track-list__row--selected",
            isNowPlaying && "track-list__row--playing",
            isImporting && "track-list__row--importing",
          ]
            .filter(Boolean)
            .join(" ")}
          style={gridStyle}
          onClick={(e) => {
            if (!isInteractive) return;
            onSelectTrack(track, e);
          }}
          onDoubleClick={() => {
            if (!isInteractive) return;
            onPlayTrack(track);
          }}
          onKeyDown={(e) => {
            if (!isInteractive) return;
            if (e.key === "Enter") onPlayTrack(track);
          }}
        >
          {visibleColumns.map((col) => {
            if (col.id === indexColumn) {
              return (
                <span
                  key={col.id}
                  className={[
                    "track-list__cell",
                    "track-list__cell--index",
                    canReorder && "track-list__cell--index-reorder",
                    col.align === "center" && "track-list__cell--center",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {canReorder ? (
                    <span
                      className="track-list__drag-handle"
                      aria-label={`Reorder ${track.title}`}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        onStartReorder(e, displayIndex);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <IconGrip className="track-list__drag-icon" />
                    </span>
                  ) : null}
                  <span className="track-list__index-num">
                    {isImporting ? (
                      <span
                        className="track-list__import-spinner"
                        aria-label="Importing"
                      />
                    ) : isActivelyPlaying ? (
                      <PlayingIndicator active inline />
                    ) : (
                      indexDisplay(track, displayIndex, indexColumn)
                    )}
                  </span>
                </span>
              );
            }

            if (col.id === "title") {
              return (
                <span
                  key={col.id}
                  className="track-list__cell track-list__cell--title"
                >
                  <TrackItemTitle track={track} showAlbumArt={showAlbumArt} />
                </span>
              );
            }

            const cellClassName = [
              "track-list__cell",
              col.secondary && "track-list__cell--secondary",
              col.align === "center" && "track-list__cell--center",
              col.align === "right" && "track-list__cell--right",
              col.id === "duration" && "track-list__cell--duration",
            ]
              .filter(Boolean)
              .join(" ");

            if (col.id === "artist" && hasNavigableArtist(track)) {
              const label = track.artist ?? "—";
              return (
                <span key={col.id} className={cellClassName}>
                  <TrackListCellLink
                    label={label}
                    ariaLabel={`View artist ${label}`}
                    onClick={() =>
                      openArtist(navigationArtistKey(track, artistBrowseMode))
                    }
                  />
                </span>
              );
            }

            if (col.id === "album" && hasNavigableAlbum(track)) {
              const label = track.album ?? "—";
              return (
                <span key={col.id} className={cellClassName}>
                  <TrackListCellLink
                    label={label}
                    ariaLabel={`View album ${label}`}
                    onClick={() => openAlbum(navigationAlbumKey(track))}
                  />
                </span>
              );
            }

            return (
              <span key={col.id} className={cellClassName}>
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
}

function rowPropsEqual(
  prev: TrackListRowProps,
  next: TrackListRowProps,
): boolean {
  return (
    prev.track === next.track &&
    prev.track.id === next.track.id &&
    prev.displayIndex === next.displayIndex &&
    prev.isSelected === next.isSelected &&
    prev.isNowPlaying === next.isNowPlaying &&
    prev.isActivelyPlaying === next.isActivelyPlaying &&
    prev.isDragging === next.isDragging &&
    prev.isDragOver === next.isDragOver &&
    prev.showAlbumArt === next.showAlbumArt &&
    prev.canReorder === next.canReorder &&
    prev.playlistId === next.playlistId &&
    prev.visibleColumns === next.visibleColumns &&
    prev.indexColumn === next.indexColumn &&
    prev.gridStyle === next.gridStyle &&
    prev.onSelectTrack === next.onSelectTrack &&
    prev.onPlayTrack === next.onPlayTrack &&
    prev.onStartReorder === next.onStartReorder
  );
}

export const TrackListRow = memo(TrackListRowComponent, rowPropsEqual);

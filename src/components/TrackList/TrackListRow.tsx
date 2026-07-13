import { Fragment, memo, useCallback, useRef, type CSSProperties, type ReactNode } from "react";
import { DEFAULT_ARTIST_JOIN_DELIMITER } from "../../lib/artistNames";
import { formatTrackLyricsColumnLabel } from "../../lib/lyrics";
import { formatDateAdded, formatTime } from "../../lib/format";
import { formatBitrate, formatCodec, formatSampleRate } from "../../lib/formatAudio";
import {
  artistLinksForTrack,
  hasNavigableAlbum,
  type TrackArtistLink,
} from "../../lib/trackNavigation";
import {
  isTrackImporting,
  isTrackInteractive,
} from "../../lib/pendingImportTrack";
import { isTrackMissingFile } from "../../lib/missingFileTrack";
import { IconCheck, IconGrip, IconMissingFile } from "../icons";
import { ImportIndicator } from "../ImportIndicator/ImportIndicator";
import { PlayingIndicator } from "../PlayingIndicator/PlayingIndicator";
import { TrackItemTitle } from "../TrackItemTitle/TrackItemTitle";
import { TrackRating } from "../TrackRating/TrackRating";
import { TrackRowMenu } from "../TrackRowMenu/TrackRowMenu";
import { CdTrackRowMenu } from "../CdTrackRowMenu/CdTrackRowMenu";
import type { TrackListColumnDef, TrackListColumnId } from "./types";
import type { Track } from "../../types/track";
import type { CanonicalRating } from "../../lib/trackRating";
import type { CellControlColumn, CellControlLocation } from "./trackListRowCellNav";
import { handleTrackListRowCellKeyDown } from "./trackListRowCellNav";

function formatTrackNumber(track: Track): string {
  if (track.trackNumber == null) return "—";
  if (track.totalTracks != null) {
    return `${track.trackNumber} of ${track.totalTracks}`;
  }
  return String(track.trackNumber);
}

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
      return formatTrackNumber(track);
    case "dateAdded":
      return formatDateAdded(track.dateAdded);
    case "playCount":
      return String(track.playCount);
    case "codec":
      return formatCodec(track.codec) ?? "—";
    case "sampleRate":
      return formatSampleRate(track.sampleRate) ?? "—";
    case "bitrate":
      return formatBitrate(track.bitrate) ?? "—";
    case "lyrics":
      return formatTrackLyricsColumnLabel(track.lyricsFormat);
    default:
      return "—";
  }
}

interface TrackListCellLinkProps {
  label: string;
  ariaLabel: string;
  column: CellControlColumn;
  subIndex?: number;
  onClick: () => void;
}

function TrackListCellLink({
  label,
  ariaLabel,
  column,
  subIndex = 0,
  onClick,
}: TrackListCellLinkProps) {
  return (
    <button
      type="button"
      className="track-list__cell-link"
      tabIndex={-1}
      data-track-list-cell-control
      data-track-list-cell-column={column}
      data-track-list-cell-sub-index={subIndex}
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

interface TrackListArtistCellProps {
  links: TrackArtistLink[];
  onOpenArtist: (artistKey: string) => void;
}

function TrackListArtistCell({ links, onOpenArtist }: TrackListArtistCellProps) {
  if (links.length === 0) return <>—</>;

  let linkableIndex = 0;

  return (
    <span className="track-list__cell-link-host">
      {links.map((link, index) => {
        const linkSubIndex = link.linkable ? linkableIndex++ : null;
        return (
          <Fragment key={`${link.key}-${index}`}>
            {index > 0 ? DEFAULT_ARTIST_JOIN_DELIMITER : null}
            {link.linkable ? (
              <TrackListCellLink
                label={link.name}
                ariaLabel={`View artist ${link.name}`}
                column="artist"
                subIndex={linkSubIndex ?? 0}
                onClick={() => onOpenArtist(link.key)}
              />
            ) : (
              link.name
            )}
          </Fragment>
        );
      })}
    </span>
  );
}

function indexDisplay(
  track: Track,
  displayIndex: number,
  indexColumn: "index" | "trackNumber",
): string {
  if (indexColumn === "trackNumber") {
    return formatTrackNumber(track);
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
  checkMode?: boolean;
  isChecked?: boolean;
  onToggleChecked?: (track: Track, checked: boolean) => void;
  isNowPlaying: boolean;
  isActivelyPlaying: boolean;
  /** Set by SortableTrackListRow when reorderable. */
  isDragging?: boolean;
  itemRef?: (element: Element | null) => void;
  dragHandleRef?: (element: Element | null) => void;
  onSelectTrack: (track: Track, e: React.MouseEvent) => void;
  onPlayTrack: (track: Track) => void;
  onOpenArtist: (artistKey: string) => void;
  onOpenAlbum: (track: Track) => void;
  onRatingChange?: (trackId: number, rating: CanonicalRating) => void;
  linkableArtistKeys: ReadonlySet<string>;
  canNavigateAlbum?: (track: Track) => boolean;
  readOnly?: boolean;
  cdDriveId?: string;
  cdTracks?: Track[];
  cdImportingTrackIds?: ReadonlySet<number>;
  cdImportingActiveTrackId?: number | null;
  cdImportCompletedTrackIds?: ReadonlySet<number>;
  virtualStyle?: CSSProperties;
  tabIndex: number;
  rowRef: (element: HTMLDivElement | null) => void;
  onRowFocus: () => void;
  onRowKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onRowCellNavigation: (
    e: React.KeyboardEvent,
    location: CellControlLocation,
  ) => void;
  onRowClick: () => void;
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
  checkMode = false,
  isChecked = false,
  onToggleChecked,
  isNowPlaying,
  isActivelyPlaying,
  isDragging = false,
  itemRef,
  dragHandleRef,
  onSelectTrack,
  onPlayTrack,
  onOpenArtist,
  onOpenAlbum,
  onRatingChange,
  linkableArtistKeys,
  canNavigateAlbum = hasNavigableAlbum,
  readOnly = false,
  cdDriveId,
  cdTracks,
  cdImportingTrackIds,
  cdImportingActiveTrackId = null,
  cdImportCompletedTrackIds,
  virtualStyle,
  tabIndex,
  rowRef,
  onRowFocus,
  onRowKeyDown,
  onRowCellNavigation,
  onRowClick,
}: TrackListRowProps) {
  const isImporting = isTrackImporting(track);
  const isMissingFile = isTrackMissingFile(track);
  const isCdImporting = cdImportingTrackIds?.has(track.id) ?? false;
  const isCdImportComplete = cdImportCompletedTrackIds?.has(track.id) ?? false;
  const isCdImportingEmphasized =
    isCdImporting &&
    (cdImportingActiveTrackId == null || track.id === cdImportingActiveTrackId);
  const isCdList = cdDriveId != null && cdTracks != null;
  const isInteractive = isTrackInteractive(track) && (!readOnly || isCdList);
  const canPlay = isTrackInteractive(track) && !isCdImporting;

  const rowElementRef = useRef<HTMLDivElement | null>(null);
  const listRootRef = useRef<HTMLElement | null>(null);

  const setRowElementRef = useCallback(
    (element: HTMLDivElement | null) => {
      rowElementRef.current = element;
      listRootRef.current = element?.closest(".track-list") ?? null;
      rowRef(element);
    },
    [rowRef],
  );

  const handleRowKeyDownCapture = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const rowEl = rowElementRef.current;
      if (!rowEl) return;
      handleTrackListRowCellKeyDown(
        e,
        rowEl,
        listRootRef.current,
        onRowCellNavigation,
      );
    },
    [onRowCellNavigation],
  );

  const rowContent = (
    <div
      ref={setRowElementRef}
      role="option"
      aria-selected={isSelected}
      tabIndex={tabIndex}
      aria-disabled={isImporting || isCdImporting || undefined}
      className={[
        "track-list__row",
        showAlbumArt && "track-list__row--with-art",
        isSelected && "track-list__row--selected",
        checkMode && isChecked && "track-list__row--checked",
        isNowPlaying && "track-list__row--playing",
        (isImporting || isCdImporting) && "track-list__row--importing",
        checkMode && "track-list__row--check-mode",
      ]
        .filter(Boolean)
        .join(" ")}
      style={gridStyle}
      onFocus={onRowFocus}
      onClick={(e) => {
        if (!isInteractive) return;
        onRowClick();
        onSelectTrack(track, e);
      }}
      onDoubleClick={() => {
        if (!canPlay) return;
        onPlayTrack(track);
      }}
      onKeyDownCapture={handleRowKeyDownCapture}
      onKeyDown={onRowKeyDown}
    >
      {visibleColumns.map((col) => {
        if (col.id === "check") {
          return (
            <span
              key={col.id}
              className="track-list__cell track-list__cell--check track-list__cell--center"
            >
              <label
                className="track-list__check-label"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  className="track-list__checkbox"
                  tabIndex={-1}
                  data-track-list-cell-control
                  data-track-list-cell-column="check"
                  data-track-list-cell-sub-index={0}
                  checked={isChecked}
                  onChange={(e) =>
                    onToggleChecked?.(track, e.target.checked)
                  }
                  aria-label={`Select ${track.title}`}
                />
              </label>
            </span>
          );
        }

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
                <button
                  type="button"
                  ref={dragHandleRef}
                  className="track-list__drag-handle"
                  aria-label={`Reorder ${track.title}`}
                  tabIndex={-1}
                  onClick={(e) => e.stopPropagation()}
                >
                  <IconGrip className="track-list__drag-icon" />
                </button>
              ) : null}
              <span className="track-list__index-num">
                {isImporting ? (
                  <span
                    className="track-list__import-spinner"
                    aria-label="Importing"
                  />
                ) : isCdImportComplete ? (
                  <IconCheck
                    className="track-list__import-complete"
                    aria-label="Imported"
                  />
                ) : isCdImporting ? (
                  <ImportIndicator
                    inline
                    emphasized={isCdImportingEmphasized}
                  />
                ) : isActivelyPlaying ? (
                  <PlayingIndicator active inline />
                ) : isMissingFile ? (
                  <IconMissingFile
                    className="track-list__missing-file"
                    aria-label="File missing"
                  />
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
          (col.id === "sampleRate" || col.id === "bitrate") &&
          "track-list__cell--duration",
        ]
          .filter(Boolean)
          .join(" ");

        if (col.id === "artist") {
          const links = artistLinksForTrack(track, linkableArtistKeys);
          return (
            <span key={col.id} className={cellClassName}>
              <TrackListArtistCell
                links={links}
                onOpenArtist={onOpenArtist}
              />
            </span>
          );
        }

        if (col.id === "album" && canNavigateAlbum(track)) {
          const label = track.album ?? "—";
          return (
            <span key={col.id} className={cellClassName}>
              <span className="track-list__cell-link-host">
                <TrackListCellLink
                  label={label}
                  ariaLabel={`View album ${label}`}
                  column="album"
                  onClick={() => onOpenAlbum(track)}
                />
              </span>
            </span>
          );
        }

        if (col.id === "rating" && onRatingChange) {
          return (
            <span key={col.id} className={cellClassName}>
              <TrackRating
                value={track.rating}
                size="compact"
                disabled={!isInteractive}
                tabIndex={-1}
                cellControl
                cellColumn="rating"
                onChange={(rating) => onRatingChange(track.id, rating)}
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
  );

  return (
    <li
      ref={itemRef}
      data-track-list-index={displayIndex}
      style={virtualStyle}
      className={[
        "track-list__item",
        showAlbumArt && "track-list__item--with-art",
        isDragging && "track-list__item--dragging",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {isCdList ? (
        <CdTrackRowMenu
          track={track}
          driveId={cdDriveId}
          tracks={cdTracks}
          className="track-list__row-wrap"
        >
          {rowContent}
        </CdTrackRowMenu>
      ) : (
        <TrackRowMenu
          track={track}
          className="track-list__row-wrap"
          playlistId={playlistId}
          interactive={isInteractive}
        >
          {rowContent}
        </TrackRowMenu>
      )}
    </li>
  );
}

function virtualStyleEqual(
  prev?: CSSProperties,
  next?: CSSProperties,
): boolean {
  if (prev === next) return true;
  if (prev == null || next == null) return prev === next;
  return (
    prev.transform === next.transform &&
    prev.height === next.height &&
    prev.width === next.width
  );
}

function rowPropsEqual(
  prev: TrackListRowProps,
  next: TrackListRowProps,
): boolean {
  return (
    prev.track === next.track &&
    prev.displayIndex === next.displayIndex &&
    prev.isSelected === next.isSelected &&
    prev.checkMode === next.checkMode &&
    prev.isChecked === next.isChecked &&
    prev.onToggleChecked === next.onToggleChecked &&
    prev.isNowPlaying === next.isNowPlaying &&
    prev.isActivelyPlaying === next.isActivelyPlaying &&
    prev.isDragging === next.isDragging &&
    prev.itemRef === next.itemRef &&
    prev.dragHandleRef === next.dragHandleRef &&
    prev.showAlbumArt === next.showAlbumArt &&
    prev.canReorder === next.canReorder &&
    prev.playlistId === next.playlistId &&
    prev.visibleColumns === next.visibleColumns &&
    prev.indexColumn === next.indexColumn &&
    prev.gridStyle === next.gridStyle &&
    prev.onSelectTrack === next.onSelectTrack &&
    prev.onPlayTrack === next.onPlayTrack &&
    prev.onOpenArtist === next.onOpenArtist &&
    prev.onOpenAlbum === next.onOpenAlbum &&
    prev.onRatingChange === next.onRatingChange &&
    prev.linkableArtistKeys === next.linkableArtistKeys &&
    prev.canNavigateAlbum === next.canNavigateAlbum &&
    prev.readOnly === next.readOnly &&
    prev.cdDriveId === next.cdDriveId &&
    prev.cdTracks === next.cdTracks &&
    prev.cdImportingTrackIds === next.cdImportingTrackIds &&
    prev.cdImportingActiveTrackId === next.cdImportingActiveTrackId &&
    prev.cdImportCompletedTrackIds === next.cdImportCompletedTrackIds &&
    virtualStyleEqual(prev.virtualStyle, next.virtualStyle) &&
    prev.tabIndex === next.tabIndex &&
    prev.onRowFocus === next.onRowFocus &&
    prev.onRowKeyDown === next.onRowKeyDown &&
    prev.onRowCellNavigation === next.onRowCellNavigation &&
    prev.onRowClick === next.onRowClick
  );
}

export const TrackListRow = memo(TrackListRowComponent, rowPropsEqual);

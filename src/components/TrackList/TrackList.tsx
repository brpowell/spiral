import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import { albumKey } from "../../lib/albums";
import { groupTracksIntoArtists } from "../../lib/artists";
import { isTrackImporting, isTrackInteractive } from "../../lib/pendingImportTrack";
import { useNavigationStore } from "../../store/useNavigationStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { TrackListColumnMenu } from "./TrackListColumnMenu";
import { TrackListRow } from "./TrackListRow";
import {
  computeMinTableWidth,
  useTrackListColumns,
} from "./useTrackListColumns";
import { useTrackListHeaderMenu } from "./useTrackListHeaderMenu";
import { useTrackListColumnReorder } from "./useTrackListColumnReorder";
import {
  CHECK_COL,
  DEFAULT_COLUMN_WIDTHS,
  type TrackListColumnDef,
  type TrackListColumnId,
  type TrackListPresetId,
  type TrackListSortDir,
  type TrackListSortField,
} from "./types";
import { checkAllState } from "../../lib/trackCheckSelection";
import type { Track } from "../../types/track";
import type { CanonicalRating } from "../../lib/trackRating";
import { useTrackListVirtualizer } from "./useTrackListVirtualizer";
import { usePrefetchVirtualRowArt } from "./usePrefetchVirtualRowArt";
import { useTrackListHeaderRoving } from "./useTrackListHeaderRoving";
import { useTrackListRowRoving } from "./useTrackListRowRoving";
import "./TrackList.css";

function sortFieldForColumn(
  col: TrackListColumnDef,
): TrackListSortField | null {
  if (!col.sortable) return null;
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
  onRatingChange?: (trackId: number, rating: CanonicalRating) => void;
  sortField?: TrackListSortField;
  sortDir?: TrackListSortDir;
  onSort?: (field: TrackListSortField) => void;
  emptyMessage?: string;
  className?: string;
  showAlbumArt?: boolean;
  playlistId?: number;
  reorderable?: boolean;
  onReorderTracks?: (fromIndex: number, toIndex: number) => void;
  readOnly?: boolean;
  canNavigateAlbum?: (track: Track) => boolean;
  cdDriveId?: string;
  checkMode?: boolean;
  checkedTrackIds?: number[];
  onToggleChecked?: (track: Track, checked: boolean) => void;
  onToggleAllChecked?: (checked: boolean) => void;
  cdImportingTrackIds?: ReadonlySet<number>;
  cdImportingActiveTrackId?: number | null;
  cdImportCompletedTrackIds?: ReadonlySet<number>;
  /** Grow to fill the parent. Use false when the list lives in a page-style scroller. */
  fillHeight?: boolean;
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
  onRatingChange,
  sortField,
  sortDir,
  onSort,
  emptyMessage = "No tracks.",
  className = "",
  showAlbumArt = false,
  playlistId,
  reorderable = false,
  onReorderTracks,
  readOnly = false,
  canNavigateAlbum,
  cdDriveId,
  checkMode = false,
  checkedTrackIds = [],
  onToggleChecked,
  onToggleAllChecked,
  cdImportingTrackIds,
  cdImportingActiveTrackId = null,
  cdImportCompletedTrackIds,
  fillHeight = true,
}: TrackListProps) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLOListElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerActionsRef = useRef<HTMLDivElement>(null);

  const canReorder = reorderable && !!onReorderTracks;
  const useVirtualRows = !canReorder && tracks.length > 40;

  const openAlbum = useNavigationStore((s) => s.openAlbum);
  const openArtist = useNavigationStore((s) => s.openArtist);
  const library = usePlayerStore((s) => s.library);
  const selectionAnchorId = usePlayerStore((s) => s.selectionAnchorId);

  const linkableArtistKeys = useMemo(() => {
    const liveLibrary = library.filter((track) => !isTrackImporting(track));
    return new Set(
      groupTracksIntoArtists(liveLibrary, "performers").map((artist) => artist.key),
    );
  }, [library]);

  const handleOpenAlbum = useCallback(
    (track: Track) => {
      openAlbum(albumKey(track));
    },
    [openAlbum],
  );

  const selectedTrackIdSet = useMemo(
    () => new Set(selectedTrackIds),
    [selectedTrackIds],
  );

  const checkedTrackIdSet = useMemo(
    () => new Set(checkedTrackIds),
    [checkedTrackIds],
  );

  const trackIds = useMemo(() => tracks.map((track) => track.id), [tracks]);

  const headerCheckState = useMemo(
    () => (checkMode ? checkAllState(trackIds, checkedTrackIds) : "none"),
    [checkMode, trackIds, checkedTrackIds],
  );

  const rowEstimateSize = showAlbumArt ? 45 : 40;

  const getVirtualItemKey = useCallback(
    (index: number) => tracks[index]?.id ?? index,
    [tracks],
  );

  const virtualizer = useTrackListVirtualizer({
    enabled: useVirtualRows,
    count: tracks.length,
    listRef,
    bodyRef,
    estimateSize: rowEstimateSize,
    getItemKey: getVirtualItemKey,
    scrollRef,
  });

  const virtualRows = virtualizer.getVirtualItems();

  usePrefetchVirtualRowArt({
    enabled: useVirtualRows && showAlbumArt,
    tracks,
    virtualRows,
    isScrolling: virtualizer.isScrolling,
  });

  const {
    preset,
    visibleColumns,
    hideableColumns,
    columnWidths,
    setColumnWidth,
    toggleColumnVisibility,
    hideColumn,
    isColumnVisible,
    reorderColumns,
    canReorderColumns,
    flushSave,
  } = useTrackListColumns(presetId);

  const { draggingColumnId, dragOverColumnId, startColumnReorder } =
    useTrackListColumnReorder({
      indexColumn: preset.indexColumn,
      enabled: canReorderColumns,
      onReorder: reorderColumns,
    });

  const { onHeaderContextMenu, contextMenu: headerContextMenu } =
    useTrackListHeaderMenu({
      hideableColumns,
      isColumnVisible,
      onToggle: toggleColumnVisibility,
      onHide: hideColumn,
    });

  const displayColumns = useMemo(
    () => (checkMode ? [CHECK_COL, ...visibleColumns] : visibleColumns),
    [checkMode, visibleColumns],
  );

  const navigableHeaderColumns = useMemo(
    () => displayColumns.filter((col) => col.id !== "check"),
    [displayColumns],
  );

  const getHeaderScrollPaddingEnd = useCallback(
    () => headerActionsRef.current?.offsetWidth ?? 0,
    [],
  );

  const {
    getTabIndex: getHeaderTabIndex,
    setHeaderRef,
    onHeaderFocus,
    onHeaderKeyDown,
  } = useTrackListHeaderRoving(navigableHeaderColumns.length, {
    scrollContainerRef: scrollRef,
    getScrollPaddingEnd: getHeaderScrollPaddingEnd,
  });

  const isRowNavigable = useCallback(
    (index: number) => {
      const track = tracks[index];
      if (!track) return false;
      const isCdList = cdDriveId != null;
      const isCdImporting = cdImportingTrackIds?.has(track.id) ?? false;
      const isInteractive =
        isTrackInteractive(track) && (!readOnly || isCdList);
      const canPlay = isTrackInteractive(track) && !isCdImporting;
      return canPlay || isInteractive;
    },
    [tracks, cdDriveId, readOnly, cdImportingTrackIds],
  );

  const handleKeyboardSelectRow = useCallback(
    (track: Track) => {
      onSelectTrack(track, {
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
      } as React.MouseEvent);
    },
    [onSelectTrack],
  );

  const {
    listTabIndex,
    getRowTabIndex,
    setRowRef,
    onListFocus,
    onRowFocus,
    onBodyBlur,
    onRowKeyDown,
    onRowCellNavigation,
    onRowClick,
  } = useTrackListRowRoving({
    tracks,
    selectedTrackIds,
    selectionAnchorId,
    bodyRef,
    scrollContainerRef: scrollRef,
    isRowNavigable,
    onSelectRow: handleKeyboardSelectRow,
    onPlayRow: onPlayTrack,
    useVirtualRows,
    virtualizer,
    virtualRows,
  });

  const displayGridStyle = useMemo(() => {
    const columnParts = displayColumns.map((col) => {
      const w = columnWidths[col.id] ?? DEFAULT_COLUMN_WIDTHS[col.id] ?? 80;
      return `${w}px`;
    });
    columnParts.push("minmax(0, 1fr)");
    columnParts.push("2.25rem");
    return {
      "--track-list-columns": columnParts.join(" "),
      "--track-list-min-width": `${computeMinTableWidth(displayColumns, columnWidths)}px`,
    } as CSSProperties;
  }, [columnWidths, displayColumns]);

  const sortIndicator = (field: TrackListSortField) => {
    if (!sortField || field !== sortField) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  };

  const headerAriaSort = (
    field: TrackListSortField | null,
  ): "ascending" | "descending" | "none" | undefined => {
    if (!field || !onSort) return undefined;
    if (sortField !== field) return "none";
    return sortDir === "asc" ? "ascending" : "descending";
  };

  const renderHeaderCell = (col: TrackListColumnDef) => {
    const field = sortFieldForColumn(col);
    const label = `${col.label}${field && onSort ? sortIndicator(field) : ""}`;
    const isIndexColumn = col.id === preset.indexColumn;
    const isColumnReorderable = canReorderColumns && !isIndexColumn;
    const isSortable = Boolean(onSort && field);

    const showHeaderCheckbox =
      checkMode && col.id === "check" && onToggleAllChecked != null;

    const width =
      columnWidths[col.id] ?? DEFAULT_COLUMN_WIDTHS[col.id] ?? 80;

    if (showHeaderCheckbox) {
      return (
        <div
          key={col.id}
          className={[
            "track-list__header-cell",
            col.align === "center" && "track-list__cell--center",
            col.align === "right" && "track-list__cell--right",
          ]
            .filter(Boolean)
            .join(" ")}
          data-track-list-col={col.id}
        >
          <label className="track-list__check-label track-list__check-label--header">
            <input
              type="checkbox"
              className="track-list__checkbox"
              checked={headerCheckState === "all"}
              ref={(el) => {
                if (el) el.indeterminate = headerCheckState === "some";
              }}
              onChange={(e) => onToggleAllChecked(e.target.checked)}
              aria-label="Select all tracks"
            />
          </label>
        </div>
      );
    }

    const navIndex = navigableHeaderColumns.findIndex(
      (navCol) => navCol.id === col.id,
    );

    return (
      <div
        key={col.id}
        ref={navIndex >= 0 ? setHeaderRef(navIndex) : undefined}
        role="columnheader"
        tabIndex={navIndex >= 0 ? getHeaderTabIndex(navIndex) : undefined}
        aria-sort={headerAriaSort(field)}
        className={[
          "track-list__header-cell",
          col.resizable && "track-list__header-cell--resizable",
          isColumnReorderable && "track-list__header-cell--reorderable",
          isSortable && "track-list__header-cell--sortable",
          draggingColumnId === col.id &&
            "track-list__header-cell--column-dragging",
          dragOverColumnId === col.id &&
            draggingColumnId != null &&
            draggingColumnId !== col.id &&
            "track-list__header-cell--column-drag-over",
          col.align === "center" && "track-list__cell--center",
          col.align === "right" && "track-list__cell--right",
        ]
          .filter(Boolean)
          .join(" ")}
        data-track-list-col={col.id}
        onFocus={navIndex >= 0 ? () => onHeaderFocus(navIndex) : undefined}
        onKeyDown={
          navIndex >= 0
            ? (e) =>
                onHeaderKeyDown(
                  e,
                  navIndex,
                  isSortable && field ? () => onSort!(field) : undefined,
                )
            : undefined
        }
        onClick={
          !isColumnReorderable && isSortable && field
            ? () => onSort!(field)
            : undefined
        }
        onPointerDown={
          isColumnReorderable
            ? (e) =>
                startColumnReorder(
                  e,
                  col.id,
                  isSortable && field ? () => onSort!(field) : undefined,
                )
            : undefined
        }
        onContextMenu={
          hideableColumns.length > 0 ? onHeaderContextMenu(col) : undefined
        }
      >
        <span className="track-list__header-label">{label}</span>
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

  const findReorderIndexAt = useCallback(
    (clientX: number, clientY: number): number | null => {
      const target = document.elementFromPoint(clientX, clientY);
      const item = target?.closest("[data-track-list-index]");
      if (!item) return null;
      const index = item.getAttribute("data-track-list-index");
      return index != null ? Number(index) : null;
    },
    [],
  );

  const startReorder = useCallback(
    (e: React.PointerEvent, fromIndex: number) => {
      if (!canReorder || !onReorderTracks) return;
      e.preventDefault();
      e.stopPropagation();
      setDraggingIndex(fromIndex);

      const onMove = (ev: PointerEvent) => {
        const index = findReorderIndexAt(ev.clientX, ev.clientY);
        if (index != null) setDragOverIndex(index);
      };

      const onUp = (ev: PointerEvent) => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        const toIndex = findReorderIndexAt(ev.clientX, ev.clientY);
        if (toIndex != null && toIndex !== fromIndex) {
          onReorderTracks(fromIndex, toIndex);
        }
        setDraggingIndex(null);
        setDragOverIndex(null);
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [canReorder, findReorderIndexAt, onReorderTracks],
  );

  const renderRow = (
    track: Track,
    displayIndex: number,
    virtualStyle?: CSSProperties,
  ) => {
    const isSelected =
      !track.importStatus && selectedTrackIdSet.has(track.id);
    const isChecked = checkMode && checkedTrackIdSet.has(track.id);
    const isNowPlaying = track.id === currentTrackId;
    const isActivelyPlaying = isNowPlaying && playbackState === "playing";
    const rowKey = track.importSourcePath ?? String(track.id);

    return (
      <TrackListRow
        key={rowKey}
        track={track}
        displayIndex={displayIndex}
        showAlbumArt={showAlbumArt}
        visibleColumns={displayColumns}
        indexColumn={preset.indexColumn}
        gridStyle={displayGridStyle}
        canReorder={canReorder}
        playlistId={playlistId}
        isSelected={isSelected}
        checkMode={checkMode}
        isChecked={isChecked}
        onToggleChecked={onToggleChecked}
        isNowPlaying={isNowPlaying}
        isActivelyPlaying={isActivelyPlaying}
        isDragging={draggingIndex === displayIndex}
        isDragOver={
          dragOverIndex === displayIndex &&
          draggingIndex != null &&
          draggingIndex !== displayIndex
        }
        onSelectTrack={onSelectTrack}
        onPlayTrack={onPlayTrack}
        onRatingChange={onRatingChange}
        onStartReorder={startReorder}
        onOpenArtist={openArtist}
        onOpenAlbum={handleOpenAlbum}
        linkableArtistKeys={linkableArtistKeys}
        canNavigateAlbum={canNavigateAlbum}
        readOnly={readOnly}
        cdDriveId={cdDriveId}
        cdTracks={cdDriveId != null ? tracks : undefined}
        cdImportingTrackIds={cdImportingTrackIds}
        cdImportingActiveTrackId={cdImportingActiveTrackId}
        cdImportCompletedTrackIds={cdImportCompletedTrackIds}
        virtualStyle={virtualStyle}
        tabIndex={getRowTabIndex(displayIndex)}
        rowRef={setRowRef(displayIndex)}
        onRowFocus={() => onRowFocus(displayIndex)}
        onRowKeyDown={(e) => onRowKeyDown(displayIndex, e)}
        onRowCellNavigation={(e, location) =>
          onRowCellNavigation(displayIndex, e, location)
        }
        onRowClick={() => onRowClick(displayIndex)}
      />
    );
  };

  const listClassName = [
    "track-list",
    !fillHeight && "track-list--content-height",
    canReorder && "track-list--reorderable",
    draggingColumnId != null && "track-list--column-dragging",
    checkMode && "track-list--check-mode",
    useVirtualRows && virtualizer.isScrolling && "track-list--scrolling",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const headerRow = (
    <div className="track-list__header">
      <div className="track-list__header-sync" role="row">
        {displayColumns.map(renderHeaderCell)}
        <div className="track-list__filler" aria-hidden />
        <div ref={headerActionsRef} className="track-list__header-actions">
          {hideableColumns.length > 0 ? (
            <TrackListColumnMenu
              columns={hideableColumns}
              isColumnVisible={isColumnVisible}
              onToggle={toggleColumnVisibility}
            />
          ) : null}
        </div>
      </div>
    </div>
  );

  const bodyContent =
    tracks.length === 0 ? (
      <p className="track-list__empty">{emptyMessage}</p>
    ) : useVirtualRows ? (
      <ol
        ref={bodyRef}
        className="track-list__body track-list__body--virtual"
        style={{ height: virtualizer.getTotalSize() }}
        role="listbox"
        aria-label="Tracks"
        tabIndex={listTabIndex}
        onFocus={onListFocus}
        onBlur={onBodyBlur}
      >
        {virtualRows.map((virtualRow) =>
          renderRow(tracks[virtualRow.index], virtualRow.index, {
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: virtualRow.size,
            transform: `translate3d(0, ${virtualRow.start - virtualizer.options.scrollMargin}px, 0)`,
          }),
        )}
      </ol>
    ) : (
      <ol
        ref={bodyRef}
        className="track-list__body"
        role="listbox"
        aria-label="Tracks"
        tabIndex={listTabIndex}
        onFocus={onListFocus}
        onBlur={onBodyBlur}
      >
        {tracks.map((track, displayIndex) =>
          renderRow(track, displayIndex),
        )}
      </ol>
    );

  return (
    <>
      <div ref={listRef} className={listClassName}>
        <div ref={scrollRef} className="track-list__scroll">
          <div className="track-list__table" style={displayGridStyle}>
            {headerRow}
            <div className="track-list__inner">{bodyContent}</div>
          </div>
        </div>
      </div>
      {headerContextMenu}
    </>
  );
}

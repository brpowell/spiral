import type { VirtualItem, Virtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { Track } from "../../types/track";
import {
  findMatchingCellControl,
  type CellControlLocation,
} from "./trackListRowCellNav";

interface UseTrackListRowRovingOptions {
  tracks: Track[];
  selectedTrackIds: number[];
  selectionAnchorId: number | null;
  bodyRef: RefObject<HTMLOListElement | null>;
  scrollContainerRef: RefObject<HTMLElement | null>;
  isRowNavigable: (index: number) => boolean;
  onSelectRow: (track: Track) => void;
  onPlayRow: (track: Track) => void;
  useVirtualRows: boolean;
  virtualizer: Virtualizer<HTMLElement, Element>;
  virtualRows: VirtualItem[];
}

function getVisibleRowBounds(scrollEl: HTMLElement) {
  const containerRect = scrollEl.getBoundingClientRect();
  const stickyHeader = scrollEl.querySelector(".track-list__header");
  const headerHeight = stickyHeader?.getBoundingClientRect().height ?? 0;
  return {
    visibleTop: containerRect.top + headerHeight,
    visibleBottom: containerRect.bottom,
  };
}

function isRowOverlappingViewport(
  start: number,
  end: number,
  visibleTop: number,
  visibleBottom: number,
): boolean {
  return end > visibleTop && start < visibleBottom;
}

function findFirstVisibleNavigableIndex(
  tracks: Track[],
  isRowNavigable: (index: number) => boolean,
  scrollEl: HTMLElement | null,
  bodyEl: HTMLOListElement | null,
  useVirtualRows: boolean,
  virtualRows: VirtualItem[],
  scrollMargin: number,
): number {
  if (scrollEl && bodyEl) {
    const { visibleTop, visibleBottom } = getVisibleRowBounds(scrollEl);
    let bestIndex: number | null = null;

    for (const element of bodyEl.querySelectorAll("[data-track-list-index]")) {
      const rect = element.getBoundingClientRect();
      if (!isRowOverlappingViewport(rect.top, rect.bottom, visibleTop, visibleBottom)) {
        continue;
      }

      const index = Number(element.getAttribute("data-track-list-index"));
      if (!Number.isFinite(index) || !isRowNavigable(index)) continue;

      if (bestIndex == null || index < bestIndex) {
        bestIndex = index;
      }
    }

    if (bestIndex != null) return bestIndex;
  }

  if (useVirtualRows && scrollEl && virtualRows.length > 0) {
    const headerHeight =
      scrollEl.querySelector(".track-list__header")?.getBoundingClientRect()
        .height ?? 0;
    const viewTop = scrollEl.scrollTop + headerHeight - scrollMargin;
    const viewBottom = scrollEl.scrollTop + scrollEl.clientHeight;

    const visibleItems = virtualRows
      .filter((item) =>
        isRowOverlappingViewport(item.start, item.end, viewTop, viewBottom),
      )
      .sort((a, b) => a.index - b.index);

    for (const item of visibleItems) {
      if (isRowNavigable(item.index)) return item.index;
    }
  }

  for (let index = 0; index < tracks.length; index++) {
    if (isRowNavigable(index)) return index;
  }

  return 0;
}

function findNextNavigableIndex(
  from: number,
  direction: 1 | -1,
  count: number,
  isRowNavigable: (index: number) => boolean,
): number {
  let index = from + direction;
  while (index >= 0 && index < count) {
    if (isRowNavigable(index)) return index;
    index += direction;
  }
  return from;
}

function findEdgeNavigableIndex(
  count: number,
  direction: 1 | -1,
  isRowNavigable: (index: number) => boolean,
): number {
  const start = direction === 1 ? 0 : count - 1;
  return findNextNavigableIndex(start - direction, direction, count, isRowNavigable);
}

function isRowVisibleInViewport(
  scrollEl: HTMLElement,
  rowElement: HTMLElement,
): boolean {
  const { visibleTop, visibleBottom } = getVisibleRowBounds(scrollEl);
  const rect = rowElement.getBoundingClientRect();
  return isRowOverlappingViewport(rect.top, rect.bottom, visibleTop, visibleBottom);
}

function isRowFullyVisibleInViewport(
  scrollEl: HTMLElement,
  rowElement: HTMLElement,
): boolean {
  const { visibleTop, visibleBottom } = getVisibleRowBounds(scrollEl);
  const rect = rowElement.getBoundingClientRect();
  return rect.top >= visibleTop && rect.bottom <= visibleBottom;
}

function isVirtualIndexVisibleInViewport(
  index: number,
  scrollEl: HTMLElement,
  virtualRows: VirtualItem[],
  scrollMargin: number,
): boolean {
  const item = virtualRows.find((row) => row.index === index);
  if (!item) return false;

  const headerHeight =
    scrollEl.querySelector(".track-list__header")?.getBoundingClientRect()
      .height ?? 0;
  const viewTop = scrollEl.scrollTop + headerHeight - scrollMargin;
  const viewBottom = scrollEl.scrollTop + scrollEl.clientHeight;
  return isRowOverlappingViewport(item.start, item.end, viewTop, viewBottom);
}

function isVirtualIndexFullyVisibleInViewport(
  index: number,
  scrollEl: HTMLElement,
  virtualRows: VirtualItem[],
  scrollMargin: number,
): boolean {
  const item = virtualRows.find((row) => row.index === index);
  if (!item) return false;

  const headerHeight =
    scrollEl.querySelector(".track-list__header")?.getBoundingClientRect()
      .height ?? 0;
  const viewTop = scrollEl.scrollTop + headerHeight - scrollMargin;
  const viewBottom = scrollEl.scrollTop + scrollEl.clientHeight;
  return item.start >= viewTop && item.end <= viewBottom;
}

function isIndexVisibleInViewport(
  index: number,
  scrollEl: HTMLElement,
  rowRefs: Map<number, HTMLDivElement>,
  useVirtualRows: boolean,
  virtualRows: VirtualItem[],
  scrollMargin: number,
): boolean {
  const rowEl = rowRefs.get(index);
  if (rowEl) {
    return isRowVisibleInViewport(scrollEl, rowEl);
  }
  if (useVirtualRows) {
    return isVirtualIndexVisibleInViewport(
      index,
      scrollEl,
      virtualRows,
      scrollMargin,
    );
  }
  return false;
}

function findTrackIndex(tracks: Track[], trackId: number): number {
  return tracks.findIndex((track) => track.id === trackId);
}

function scrollRowIntoView(
  scrollContainer: HTMLElement,
  rowElement: HTMLElement | null,
) {
  if (!rowElement) return;

  const { visibleTop, visibleBottom } = getVisibleRowBounds(scrollContainer);
  const rowRect = rowElement.getBoundingClientRect();

  if (rowRect.top < visibleTop) {
    scrollContainer.scrollTop += rowRect.top - visibleTop;
  } else if (rowRect.bottom > visibleBottom) {
    scrollContainer.scrollTop += rowRect.bottom - visibleBottom;
  }
}

export function useTrackListRowRoving({
  tracks,
  selectedTrackIds,
  selectionAnchorId,
  bodyRef,
  scrollContainerRef,
  isRowNavigable,
  onSelectRow,
  onPlayRow,
  useVirtualRows,
  virtualizer,
  virtualRows,
}: UseTrackListRowRovingOptions) {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const getFirstVisibleIndex = useCallback(() => {
    return findFirstVisibleNavigableIndex(
      tracks,
      isRowNavigable,
      scrollContainerRef.current,
      bodyRef.current,
      useVirtualRows,
      virtualRows,
      virtualizer.options.scrollMargin,
    );
  }, [
    bodyRef,
    isRowNavigable,
    scrollContainerRef,
    tracks,
    useVirtualRows,
    virtualRows,
    virtualizer.options.scrollMargin,
  ]);

  const getPreferredFocusIndex = useCallback(() => {
    const scrollEl = scrollContainerRef.current;
    const candidateIds: number[] = [];
    if (selectionAnchorId != null) {
      candidateIds.push(selectionAnchorId);
    }
    for (const trackId of selectedTrackIds) {
      if (!candidateIds.includes(trackId)) {
        candidateIds.push(trackId);
      }
    }

    if (scrollEl && candidateIds.length > 0) {
      for (const trackId of candidateIds) {
        const index = findTrackIndex(tracks, trackId);
        if (index < 0 || !isRowNavigable(index)) continue;
        if (
          isIndexVisibleInViewport(
            index,
            scrollEl,
            rowRefs.current,
            useVirtualRows,
            virtualRows,
            virtualizer.options.scrollMargin,
          )
        ) {
          return index;
        }
      }
    }

    return getFirstVisibleIndex();
  }, [
    getFirstVisibleIndex,
    isRowNavigable,
    scrollContainerRef,
    selectedTrackIds,
    selectionAnchorId,
    tracks,
    useVirtualRows,
    virtualRows,
    virtualizer.options.scrollMargin,
  ]);

  useEffect(() => {
    if (tracks.length === 0) {
      setFocusedIndex(null);
      return;
    }
    if (focusedIndex != null && focusedIndex >= tracks.length) {
      setFocusedIndex(tracks.length - 1);
    }
  }, [focusedIndex, tracks.length]);

  const scrollToRow = useCallback(
    (index: number) => {
      const scrollContainer = scrollContainerRef.current;
      const rowElement = rowRefs.current.get(index) ?? null;
      const scrollMargin = virtualizer.options.scrollMargin;

      const isFullyVisible =
        scrollContainer &&
        (rowElement
          ? isRowFullyVisibleInViewport(scrollContainer, rowElement)
          : useVirtualRows &&
            isVirtualIndexFullyVisibleInViewport(
              index,
              scrollContainer,
              virtualRows,
              scrollMargin,
            ));

      if (useVirtualRows && scrollContainer && !isFullyVisible) {
        virtualizer.scrollToIndex(index, { align: "auto" });
      }

      requestAnimationFrame(() => {
        const container = scrollContainerRef.current;
        if (!container) return;
        scrollRowIntoView(container, rowRefs.current.get(index) ?? null);
      });
    },
    [scrollContainerRef, useVirtualRows, virtualRows, virtualizer],
  );

  const activateRow = useCallback(
    (index: number, options?: { select?: boolean; scroll?: boolean }) => {
      const track = tracks[index];
      if (!track || !isRowNavigable(index)) return;

      setFocusedIndex(index);
      if (options?.select !== false) {
        onSelectRow(track);
      }
      if (options?.scroll !== false) {
        scrollToRow(index);
      }
    },
    [isRowNavigable, onSelectRow, scrollToRow, tracks],
  );

  const focusRowElement = useCallback((index: number, attempt = 0) => {
    const element = rowRefs.current.get(index);
    if (element) {
      element.focus({ preventScroll: true });
      return;
    }
    if (attempt < 6) {
      requestAnimationFrame(() => focusRowElement(index, attempt + 1));
    }
  }, []);

  const focusCellInRow = useCallback(
    (index: number, location: CellControlLocation, attempt = 0) => {
      const rowEl = rowRefs.current.get(index);
      const match = rowEl ? findMatchingCellControl(rowEl, location) : null;
      if (match) {
        match.focus({ preventScroll: true, focusVisible: true });
        return;
      }
      if (attempt < 6) {
        requestAnimationFrame(() => focusCellInRow(index, location, attempt + 1));
        return;
      }
      focusRowElement(index);
    },
    [focusRowElement],
  );

  const focusRowAtCell = useCallback(
    (index: number, location: CellControlLocation) => {
      const track = tracks[index];
      if (!track || !isRowNavigable(index)) return;

      setFocusedIndex(index);
      onSelectRow(track);
      scrollToRow(index);
      requestAnimationFrame(() => focusCellInRow(index, location));
    },
    [focusCellInRow, isRowNavigable, onSelectRow, scrollToRow, tracks],
  );

  const focusRow = useCallback(
    (index: number, options?: { select?: boolean; scroll?: boolean }) => {
      activateRow(index, options);
      requestAnimationFrame(() => focusRowElement(index));
    },
    [activateRow, focusRowElement],
  );

  const focusedRowInTabOrder = useCallback(() => {
    if (focusedIndex == null) return false;
    const scrollEl = scrollContainerRef.current;
    const rowEl = rowRefs.current.get(focusedIndex);
    if (!scrollEl || !rowEl) return false;
    return isRowVisibleInViewport(scrollEl, rowEl);
  }, [focusedIndex, scrollContainerRef]);

  useEffect(() => {
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl || focusedIndex == null) return;

    const onScroll = () => {
      const rowEl = rowRefs.current.get(focusedIndex);
      if (!rowEl) return;
      if (!isRowVisibleInViewport(scrollEl, rowEl)) {
        setFocusedIndex(null);
      }
    };

    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", onScroll);
  }, [focusedIndex, scrollContainerRef]);

  const listTabIndex =
    tracks.length > 0 && !focusedRowInTabOrder() ? 0 : -1;

  const getRowTabIndex = useCallback(
    (index: number) =>
      focusedIndex === index &&
      isRowNavigable(index) &&
      focusedRowInTabOrder()
        ? 0
        : -1,
    [focusedIndex, focusedRowInTabOrder, isRowNavigable],
  );

  const setRowRef = useCallback(
    (index: number) => (element: HTMLDivElement | null) => {
      if (element) rowRefs.current.set(index, element);
      else rowRefs.current.delete(index);
    },
    [],
  );

  const onListFocus = useCallback(
    (e: React.FocusEvent<HTMLOListElement>) => {
      if (e.target !== e.currentTarget) return;
      const scrollEl = scrollContainerRef.current;
      const scrollTopBefore = scrollEl?.scrollTop ?? null;
      const preferred = getPreferredFocusIndex();
      focusRow(preferred, { scroll: false, select: false });
      requestAnimationFrame(() => {
        if (scrollEl && scrollTopBefore != null && scrollEl.scrollTop !== scrollTopBefore) {
          scrollEl.scrollTop = scrollTopBefore;
        }
      });
    },
    [focusRow, getPreferredFocusIndex, scrollContainerRef],
  );

  const onRowFocus = useCallback((index: number) => {
    setFocusedIndex(index);
  }, []);

  const onBodyBlur = useCallback(
    (e: React.FocusEvent) => {
      if (!bodyRef.current?.contains(e.relatedTarget as Node)) {
        setFocusedIndex(null);
      }
    },
    [bodyRef],
  );

  const onRowKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent) => {
      const track = tracks[index];
      if (!track) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          focusRow(
            findNextNavigableIndex(
              index,
              1,
              tracks.length,
              isRowNavigable,
            ),
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          focusRow(
            findNextNavigableIndex(
              index,
              -1,
              tracks.length,
              isRowNavigable,
            ),
          );
          break;
        case "Home":
          e.preventDefault();
          focusRow(
            findEdgeNavigableIndex(tracks.length, 1, isRowNavigable),
          );
          break;
        case "End":
          e.preventDefault();
          focusRow(
            findEdgeNavigableIndex(tracks.length, -1, isRowNavigable),
          );
          break;
        case "Enter":
          e.preventDefault();
          onPlayRow(track);
          break;
        case " ":
          e.preventDefault();
          activateRow(index);
          break;
        default:
          break;
      }
    },
    [
      activateRow,
      focusRow,
      isRowNavigable,
      onPlayRow,
      tracks,
    ],
  );

  const onRowCellNavigation = useCallback(
    (index: number, e: React.KeyboardEvent, location: CellControlLocation) => {
      const direction = e.key === "ArrowDown" ? 1 : -1;
      const nextIndex = findNextNavigableIndex(
        index,
        direction,
        tracks.length,
        isRowNavigable,
      );
      if (nextIndex === index) return;
      focusRowAtCell(nextIndex, location);
    },
    [focusRowAtCell, isRowNavigable, tracks.length],
  );

  const onRowClick = useCallback((index: number) => {
    setFocusedIndex(index);
  }, []);

  return {
    listTabIndex,
    getRowTabIndex,
    setRowRef,
    onListFocus,
    onRowFocus,
    onBodyBlur,
    onRowKeyDown,
    onRowCellNavigation,
    onRowClick,
  };
}

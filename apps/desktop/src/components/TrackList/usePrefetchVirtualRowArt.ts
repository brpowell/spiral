import { useEffect, useRef } from "react";
import type { VirtualItem } from "@tanstack/react-virtual";
import {
  cancelRowArtThumbPrefetch,
  queueRowArtThumbPrefetch,
} from "../../lib/rowArtThumb";
import type { Track } from "../../types/track";

/** Extra rows beyond the virtualizer overscan to warm ahead of scroll. */
const PREFETCH_ROW_MARGIN = 16;

/** Wait for scroll to settle before prefetching. */
const SCROLL_SETTLE_MS = 80;

interface UsePrefetchVirtualRowArtOptions {
  enabled: boolean;
  tracks: Track[];
  virtualRows: VirtualItem[];
  isScrolling: boolean;
  margin?: number;
}

function collectArtPaths(
  tracks: Track[],
  startIndex: number,
  endIndex: number,
): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (let i = startIndex; i <= endIndex; i++) {
    const artPath = tracks[i]?.artPath;
    if (!artPath || seen.has(artPath)) continue;
    seen.add(artPath);
    paths.push(artPath);
  }
  return paths;
}

export function usePrefetchVirtualRowArt({
  enabled,
  tracks,
  virtualRows,
  isScrolling,
  margin = PREFETCH_ROW_MARGIN,
}: UsePrefetchVirtualRowArtOptions) {
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRangeRef = useRef("");

  useEffect(() => {
    if (!enabled) {
      cancelRowArtThumbPrefetch();
      return;
    }

    if (virtualRows.length === 0 || tracks.length === 0) return;

    const visibleStart = virtualRows[0].index;
    const visibleEnd = virtualRows[virtualRows.length - 1].index;
    const prefetchStart = Math.max(0, visibleStart - margin);
    const prefetchEnd = Math.min(tracks.length - 1, visibleEnd + margin);
    const rangeKey = `${prefetchStart}-${prefetchEnd}-${tracks.length}`;

    if (isScrolling) {
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      cancelRowArtThumbPrefetch();
      return;
    }

    if (rangeKey === lastRangeRef.current) return;

    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
    }

    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      lastRangeRef.current = rangeKey;
      queueRowArtThumbPrefetch(
        collectArtPaths(tracks, prefetchStart, prefetchEnd),
      );
    }, SCROLL_SETTLE_MS);

    return () => {
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
    };
  }, [enabled, tracks, virtualRows, isScrolling, margin]);

  useEffect(() => {
    if (!enabled) return;
    return () => cancelRowArtThumbPrefetch();
  }, [enabled]);
}

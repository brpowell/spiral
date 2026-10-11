import { memo, useCallback, useRef, useState } from "react";
import {
  bucketToCanonical,
  canonicalToBucket,
  DEFAULT_BUCKET_COUNT,
  DEFAULT_DISPLAY_SCALE_MAX,
  UNRATED,
  type CanonicalRating,
} from "../../lib/trackRating";
import "./TrackRating.css";

const STAR_PATH =
  "M12 2.5l2.9 6.5 7.1.6-5.4 4.6 1.7 6.9L12 17.8 5.7 21.1l1.7-6.9L2 9.6l7.1-.6L12 2.5z";

export type TrackRatingSize = "compact" | "comfortable" | "fill";

export interface TrackRatingProps {
  value: CanonicalRating;
  bucketCount?: number;
  size?: TrackRatingSize;
  onChange: (rating: CanonicalRating) => void;
  disabled?: boolean;
  tabIndex?: number;
  /** Marks the control for track-list arrow-key cell navigation. */
  cellControl?: boolean;
  cellColumn?: string;
  cellSubIndex?: number;
}

function zonesPerGlyph(bucketCount: number): number {
  return bucketCount / DEFAULT_DISPLAY_SCALE_MAX;
}

function glyphFillFraction(
  glyphIndex: number,
  displayBucket: number,
  bucketCount: number,
): number {
  if (displayBucket <= 0) return 0;
  const zpg = zonesPerGlyph(bucketCount);
  const glyphStart = glyphIndex * zpg;
  const glyphEnd = glyphStart + zpg;
  if (displayBucket <= glyphStart) return 0;
  if (displayBucket >= glyphEnd) return 1;
  return (displayBucket - glyphStart) / zpg;
}

/** Map pointer x to bucket (0 = unrated, 1..n = rated). Left edge clears. */
function bucketFromClientX(
  clientX: number,
  rect: DOMRect,
  bucketCount: number,
): number {
  const x = clientX - rect.left;
  if (x <= 0) return 0;
  const ratio = x / rect.width;
  if (ratio <= 1 / (bucketCount * 2)) return 0;
  return Math.min(bucketCount, Math.ceil(ratio * bucketCount));
}

function RatingGlyph({ fill, size }: { fill: number; size: TrackRatingSize }) {
  const clampedFill = Math.max(0, Math.min(1, fill));

  return (
    <span
      className={[
        "track-rating__glyph",
        size === "comfortable" && "track-rating__glyph--comfortable",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <svg
        className="track-rating__star track-rating__star--outline"
        viewBox="0 0 24 24"
        aria-hidden
      >
        <path d={STAR_PATH} />
      </svg>
      {clampedFill > 0 ? (
        <svg
          className="track-rating__star track-rating__star--fill"
          viewBox="0 0 24 24"
          aria-hidden
          style={
            clampedFill < 1
              ? { clipPath: `inset(0 ${(1 - clampedFill) * 100}% 0 0)` }
              : undefined
          }
        >
          <path d={STAR_PATH} />
        </svg>
      ) : null}
    </span>
  );
}

function TrackRatingComponent({
  value,
  bucketCount = DEFAULT_BUCKET_COUNT,
  size = "compact",
  onChange,
  disabled = false,
  tabIndex,
  cellControl = false,
  cellColumn = "rating",
  cellSubIndex = 0,
}: TrackRatingProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [hoverBucket, setHoverBucket] = useState<number | null>(null);
  const committedBucket = canonicalToBucket(value, bucketCount);
  const displayBucket = hoverBucket ?? committedBucket;

  const bucketFromPointer = useCallback(
    (clientX: number): number => {
      const el = rootRef.current;
      if (!el) return committedBucket;
      return bucketFromClientX(
        clientX,
        el.getBoundingClientRect(),
        bucketCount,
      );
    },
    [bucketCount, committedBucket],
  );

  const commitBucket = useCallback(
    (bucket: number) => {
      if (disabled) return;
      if (bucket <= 0) {
        onChange(UNRATED);
        return;
      }
      onChange(bucketToCanonical(bucket, bucketCount));
    },
    [bucketCount, disabled, onChange],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || e.button !== 0) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      draggingRef.current = true;
      setHoverBucket(bucketFromPointer(e.clientX));
    },
    [bucketFromPointer, disabled],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current && e.pointerType === "touch") return;
      setHoverBucket((prev) => {
        const next = bucketFromPointer(e.clientX);
        return prev === next ? prev : next;
      });
    },
    [bucketFromPointer],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      e.stopPropagation();
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      const bucket = bucketFromPointer(e.clientX);
      setHoverBucket(null);
      commitBucket(bucket);
    },
    [bucketFromPointer, commitBucket],
  );

  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setHoverBucket(null);
  }, []);

  const handlePointerLeave = useCallback(() => {
    if (!draggingRef.current) setHoverBucket(null);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;

      let delta: number | null = null;
      if (cellControl) {
        if (e.key === "-" || e.key === "_") delta = -1;
        else if (e.key === "+" || e.key === "=") delta = 1;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        delta = e.key === "ArrowRight" ? 1 : -1;
      }

      if (delta == null) return;

      e.preventDefault();
      e.stopPropagation();
      const next = Math.max(0, Math.min(bucketCount, committedBucket + delta));
      commitBucket(next);
    },
    [bucketCount, cellControl, commitBucket, committedBucket, disabled],
  );

  return (
    <div
      ref={rootRef}
      className={[
        "track-rating",
        `track-rating--${size}`,
        disabled && "track-rating--disabled",
      ]
        .filter(Boolean)
        .join(" ")}
      role="slider"
      tabIndex={tabIndex}
      data-track-list-cell-control={cellControl ? "" : undefined}
      data-track-list-cell-column={cellControl ? cellColumn : undefined}
      data-track-list-cell-sub-index={cellControl ? cellSubIndex : undefined}
      aria-valuemin={0}
      aria-valuemax={bucketCount}
      aria-valuenow={committedBucket}
      aria-label={
        cellControl
          ? "Track rating. Use minus or plus to change rating."
          : "Track rating"
      }
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerLeave}
    >
      {Array.from({ length: DEFAULT_DISPLAY_SCALE_MAX }, (_, glyphIndex) => (
        <RatingGlyph
          key={glyphIndex}
          fill={glyphFillFraction(glyphIndex, displayBucket, bucketCount)}
          size={size}
        />
      ))}
    </div>
  );
}

function trackRatingPropsEqual(
  prev: TrackRatingProps,
  next: TrackRatingProps,
): boolean {
  return (
    prev.value === next.value &&
    prev.bucketCount === next.bucketCount &&
    prev.size === next.size &&
    prev.disabled === next.disabled &&
    prev.tabIndex === next.tabIndex &&
    prev.cellControl === next.cellControl &&
    prev.cellColumn === next.cellColumn &&
    prev.cellSubIndex === next.cellSubIndex &&
    prev.onChange === next.onChange
  );
}

export const TrackRating = memo(TrackRatingComponent, trackRatingPropsEqual);

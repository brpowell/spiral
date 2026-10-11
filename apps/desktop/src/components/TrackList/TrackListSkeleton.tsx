import { Skeleton } from "../common/Skeleton/Skeleton";
import "./TrackListSkeleton.css";

const ROW_COUNT = 24;

/** Row widths cycle so the placeholder reads as text, not a grid of bars. */
const TITLE_WIDTHS = ["58%", "72%", "46%", "64%", "52%", "78%"];
const ARTIST_WIDTHS = ["52%", "40%", "64%", "46%"];
const ALBUM_WIDTHS = ["60%", "48%", "70%", "42%", "56%"];

/** Placeholder for the library track list while the first load is in flight. */
export function TrackListSkeleton() {
  return (
    <div className="track-list-skeleton" aria-busy="true" aria-live="polite">
      <div className="track-list-skeleton__header" aria-hidden>
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="track-list-skeleton__body" aria-hidden>
        {Array.from({ length: ROW_COUNT }, (_, i) => (
          <div key={i} className="track-list-skeleton__row">
            <Skeleton
              className="track-list-skeleton__index"
              width="1rem"
              height="0.7rem"
              radius="pill"
            />
            <div className="track-list-skeleton__title">
              <Skeleton
                width="var(--track-list-art-size)"
                height="var(--track-list-art-size)"
                radius="sm"
                className="track-list-skeleton__art"
              />
              <Skeleton
                width={TITLE_WIDTHS[i % TITLE_WIDTHS.length]}
                height="0.7rem"
                radius="pill"
              />
            </div>
            <Skeleton
              width={ARTIST_WIDTHS[i % ARTIST_WIDTHS.length]}
              height="0.7rem"
              radius="pill"
            />
            <Skeleton
              className="track-list-skeleton__duration"
              width="2rem"
              height="0.7rem"
              radius="pill"
            />
            <Skeleton
              width={ALBUM_WIDTHS[i % ALBUM_WIDTHS.length]}
              height="0.7rem"
              radius="pill"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

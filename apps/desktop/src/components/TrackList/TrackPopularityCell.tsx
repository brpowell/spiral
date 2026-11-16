import { Tooltip } from "@/components/common/Tooltip/Tooltip";
import { popularityDescription } from "@/lib/popularity/popularityDescription";
import { POPULARITY_COLUMN_PROFILE } from "@/lib/popularity/profiles";
import {
  usePopularityFraction,
  usePopularityScore,
} from "@/hooks/usePopularity";
import { PopularityGlyph } from "./PopularityGlyph";

/**
 * A track's popularity: the rings glyph, with the score and an explainer in a tooltip on hover and
 * keyboard focus. The same words are its accessible name and description, so the score isn't
 * visual-only. It is a focusable row cell control (reached with the arrow keys, like Rating), and
 * subscribes itself so the memoized rows around it don't re-render.
 */
export function TrackPopularityCell({ trackId }: { trackId: number }) {
  const fraction = usePopularityFraction(POPULARITY_COLUMN_PROFILE, trackId);
  const score = usePopularityScore(POPULARITY_COLUMN_PROFILE, trackId);
  const { summary, explainer } = popularityDescription(score);
  return (
    <Tooltip
      // The cell already carries these words as its name and description.
      describeTrigger={false}
      content={
        <>
          <div className="popularity-tooltip__summary">{summary}</div>
          <div className="popularity-tooltip__explainer">{explainer}</div>
        </>
      }
    >
      <span
        className="track-list__popularity"
        role="img"
        aria-label={summary}
        aria-description={explainer}
        tabIndex={-1}
        data-track-list-cell-control=""
        data-track-list-cell-column="popularity"
        data-track-list-cell-sub-index={0}
      >
        <PopularityGlyph fraction={fraction} />
      </span>
    </Tooltip>
  );
}

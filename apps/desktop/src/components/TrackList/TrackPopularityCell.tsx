import { popularityDescription } from "@/lib/popularity/popularityDescription";
import { POPULARITY_COLUMN_PROFILE } from "@/lib/popularity/profiles";
import {
  usePopularityFraction,
  usePopularityScore,
} from "@/hooks/usePopularity";
import { PopularityGlyph } from "./PopularityGlyph";

/**
 * A track's popularity: the rings glyph, with the score and an explainer in its tooltip. The same
 * words are its accessible name and description, so the score isn't mouse-only. It subscribes
 * itself so the memoized rows around it don't re-render.
 */
export function TrackPopularityCell({ trackId }: { trackId: number }) {
  const fraction = usePopularityFraction(POPULARITY_COLUMN_PROFILE, trackId);
  const score = usePopularityScore(POPULARITY_COLUMN_PROFILE, trackId);
  const { summary, explainer } = popularityDescription(score);
  return (
    <span
      className="track-list__popularity"
      role="img"
      aria-label={summary}
      aria-description={explainer}
      title={`${summary}\n${explainer}`}
    >
      <PopularityGlyph fraction={fraction} />
    </span>
  );
}

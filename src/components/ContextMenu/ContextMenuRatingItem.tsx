import { TrackRating } from "../TrackRating/TrackRating";
import type { CanonicalRating } from "../../lib/trackRating";
import { IconStar } from "../icons";
import "./ContextMenuRatingItem.css";

interface ContextMenuRatingItemProps {
  value: CanonicalRating;
  onChange: (rating: CanonicalRating) => void;
}

export function ContextMenuRatingItem({
  value,
  onChange,
}: ContextMenuRatingItemProps) {
  return (
    <div className="context-menu__rating-row" role="presentation">
      <span className="context-menu__item-icon" aria-hidden>
        <IconStar />
      </span>
      <span className="context-menu__item-label">Rate</span>
      <TrackRating value={value} size="compact" onChange={onChange} />
    </div>
  );
}

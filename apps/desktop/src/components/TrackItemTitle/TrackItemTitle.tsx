import { memo } from "react";
import { EntityArt } from "../EntityArt/EntityArt";
import type { Track } from "../../types/track";
import "./TrackItemTitle.css";

export interface TrackItemTitleProps {
  track: Track;
  showAlbumArt?: boolean;
  className?: string;
}

function TrackItemTitleComponent({
  track,
  showAlbumArt = false,
  className = "",
}: TrackItemTitleProps) {
  return (
    <span
      className={[
        "track-item-title",
        showAlbumArt && "track-item-title--with-art",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {showAlbumArt ? (
        <EntityArt
          artPath={track.artPath}
          alt=""
          className="track-item-title__art album-art--row"
          variant="row"
        />
      ) : null}
      <span className="track-item-title__text" title={track.title}>
        {track.title}
      </span>
    </span>
  );
}

export const TrackItemTitle = memo(
  TrackItemTitleComponent,
  (prev, next) =>
    prev.track === next.track &&
    prev.showAlbumArt === next.showAlbumArt &&
    prev.className === next.className,
);

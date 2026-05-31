import { EntityArt } from "../EntityArt/EntityArt";
import type { Track } from "../../types/track";
import "./TrackItemTitle.css";

export interface TrackItemTitleProps {
  track: Track;
  showAlbumArt?: boolean;
  className?: string;
}

export function TrackItemTitle({
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
        />
      ) : null}
      <span className="track-item-title__text" title={track.title}>
        {track.title}
      </span>
    </span>
  );
}

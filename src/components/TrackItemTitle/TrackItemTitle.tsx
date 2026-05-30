import { EntityArt } from "../EntityArt/EntityArt";
import { PlayingIndicator } from "../PlayingIndicator/PlayingIndicator";
import type { Track } from "../../types/track";
import "./TrackItemTitle.css";

export interface TrackItemTitleProps {
  track: Track;
  isActivelyPlaying?: boolean;
  showAlbumArt?: boolean;
  className?: string;
}

export function TrackItemTitle({
  track,
  isActivelyPlaying = false,
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
      <span className="track-item-title__body">
        <PlayingIndicator active={isActivelyPlaying} inline />
        <span className="track-item-title__text" title={track.title}>
          {track.title}
        </span>
      </span>
    </span>
  );
}

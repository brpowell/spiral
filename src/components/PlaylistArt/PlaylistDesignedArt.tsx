import {
  playlistDesignBackgroundStyle,
  defaultPlaylistDesignCover,
} from "../../lib/playlistCoverPresets";
import { SpiralIcon } from "../../lib/iconLibrary";
import "./PlaylistArt.css";

interface PlaylistDesignedArtProps {
  coverBackground: string | null;
  coverBackgroundEnd: string | null;
  coverIcon: string | null;
  className?: string;
  alt?: string;
}

export function PlaylistDesignedArt({
  coverBackground,
  coverBackgroundEnd,
  coverIcon,
  className = "",
  alt = "",
}: PlaylistDesignedArtProps) {
  const defaults = defaultPlaylistDesignCover();
  const background = coverBackground?.trim() || defaults.coverBackground;
  const end = coverBackgroundEnd?.trim() || null;
  const style = playlistDesignBackgroundStyle(background, end);

  return (
    <div
      className={`playlist-art playlist-art--designed ${className}`.trim()}
      style={style}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
    >
      <span className="playlist-art__design-icon" aria-hidden>
        <SpiralIcon id={coverIcon ?? defaults.coverIcon} />
      </span>
    </div>
  );
}

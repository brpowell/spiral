import { EntityArt } from "@/components/EntityArt/EntityArt";
import { PlaylistDesignedArt } from "@/components/PlaylistArt/PlaylistDesignedArt";
import { playlistDesignBackgroundStyle } from "@/lib/playlists/playlistCoverPresets";
import type { GenreLook } from "@/hooks/useGenreLook";
import "@/components/PlaylistArt/PlaylistArt.css";
import "./GenreCover.css";

interface GenreCoverProps {
  look: GenreLook;
  className?: string;
  alt?: string;
}

/**
 * A square genre cover. A designed look is the playlist's designed art (icon
 * centered); an album look is the gradient with the album's cover in the corner.
 */
export function GenreCover({
  look,
  className = "",
  alt = "",
}: GenreCoverProps) {
  if (!look.artPath) {
    return (
      <PlaylistDesignedArt
        coverBackground={look.start}
        coverBackgroundEnd={look.end}
        coverIcon={look.icon}
        className={className}
        alt={alt}
      />
    );
  }

  return (
    <div
      className={`playlist-art playlist-art--designed genre-cover ${className}`.trim()}
      style={playlistDesignBackgroundStyle(look.start, look.end)}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
    >
      <span className="genre-cover__art" aria-hidden>
        <EntityArt artPath={look.artPath} variant="grid" />
      </span>
    </div>
  );
}

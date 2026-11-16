import type { CSSProperties } from "react";
import { EntityArt } from "@/components/EntityArt/EntityArt";
import { PlaylistDesignedArt } from "@/components/PlaylistArt/PlaylistDesignedArt";
import { genreLabelSize } from "@/lib/genres/genreLabel";
import { playlistDesignBackgroundStyle } from "@/lib/playlists/playlistCoverPresets";
import type { GenreLook } from "@/hooks/useGenreLook";
import "@/components/PlaylistArt/PlaylistArt.css";
import "./GenreCover.css";

interface GenreCoverProps {
  look: GenreLook;
  className?: string;
  alt?: string;
  /** The genre name, drawn in the top-left corner. Omit on tiny covers. */
  label?: string;
}

function GenreCoverLabel({ text }: { text: string }) {
  return (
    <span
      className="genre-cover__label"
      style={{ "--genre-label-size": genreLabelSize(text) } as CSSProperties}
      aria-hidden
    >
      {text}
    </span>
  );
}

/**
 * A square genre cover. A designed look is the playlist's designed art (icon
 * centered); an album look is the gradient with the album's cover in the corner.
 * Both can carry the genre's name in the top-left.
 */
export function GenreCover({
  look,
  className = "",
  alt = "",
  label,
}: GenreCoverProps) {
  const classes =
    `genre-cover ${label ? "genre-cover--labeled" : ""} ${className}`
      .replace(/\s+/g, " ")
      .trim();

  if (!look.artPath) {
    return (
      <PlaylistDesignedArt
        coverBackground={look.start}
        coverBackgroundEnd={look.end}
        coverIcon={look.icon}
        className={classes}
        alt={alt}
      >
        {label ? <GenreCoverLabel text={label} /> : null}
      </PlaylistDesignedArt>
    );
  }

  return (
    <div
      className={`playlist-art playlist-art--designed ${classes}`}
      style={playlistDesignBackgroundStyle(look.start, look.end)}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
    >
      <span className="genre-cover__art" aria-hidden>
        <EntityArt artPath={look.artPath} variant="grid" />
      </span>
      {label ? <GenreCoverLabel text={label} /> : null}
    </div>
  );
}

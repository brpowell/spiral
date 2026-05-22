import { useAssetUrl } from "../../hooks/useAssetUrl";
import {
  playlistGradientStyle,
  uniqueTrackArtPaths,
} from "../../lib/playlistArt";
import type { Track } from "../../types/track";
import { IconPlaylistPlaceholder } from "../icons";
import "./PlaylistArt.css";

interface PlaylistGeneratedArtProps {
  playlistId: number;
  title: string;
  tracks: Track[];
  className?: string;
  alt?: string;
}

function MosaicTile({ artPath }: { artPath: string }) {
  const src = useAssetUrl(artPath);
  if (!src) {
    return <span className="playlist-art__tile-fallback" aria-hidden />;
  }
  return <img src={src} alt="" className="playlist-art__tile-img" />;
}

export function PlaylistGeneratedArt({
  playlistId,
  title,
  tracks,
  className = "",
  alt = "",
}: PlaylistGeneratedArtProps) {
  const artPaths = uniqueTrackArtPaths(tracks);
  const gradient = playlistGradientStyle(playlistId, title);

  if (artPaths.length === 0) {
    return (
      <div
        className={`playlist-art playlist-art--generated ${className}`.trim()}
        style={gradient}
        role={alt ? "img" : undefined}
        aria-label={alt || undefined}
      >
        <span className="playlist-art__empty-icon" aria-hidden>
          <IconPlaylistPlaceholder />
        </span>
      </div>
    );
  }

  if (artPaths.length === 1) {
    return (
      <div
        className={`playlist-art playlist-art--generated playlist-art--single ${className}`.trim()}
        role={alt ? "img" : undefined}
        aria-label={alt || undefined}
      >
        <MosaicTile artPath={artPaths[0]} />
      </div>
    );
  }

  const layoutClass =
    artPaths.length === 2
      ? "playlist-art--duo"
      : artPaths.length === 3
        ? "playlist-art--trio"
        : "playlist-art--quad";

  return (
    <div
      className={`playlist-art playlist-art--generated playlist-art--mosaic ${layoutClass} ${className}`.trim()}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
    >
      {artPaths.map((path) => (
        <MosaicTile key={path} artPath={path} />
      ))}
    </div>
  );
}

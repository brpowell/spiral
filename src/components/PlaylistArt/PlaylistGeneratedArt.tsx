import { useAssetUrl } from "../../hooks/useAssetUrl";
import { uniqueAlbumArtPaths } from "../../lib/playlistArt";
import type { Track } from "../../types/track";
import { IconAlbums } from "../icons";
import "./PlaylistArt.css";

interface PlaylistGeneratedArtProps {
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
  tracks,
  className = "",
  alt = "",
}: PlaylistGeneratedArtProps) {
  const artPaths = uniqueAlbumArtPaths(tracks);

  if (artPaths.length === 0) {
    return (
      <div
        className={`playlist-art ${className}`.trim()}
        role={alt ? "img" : undefined}
        aria-label={alt || undefined}
      >
        <div className="playlist-art__placeholder" aria-hidden>
          <IconAlbums />
        </div>
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

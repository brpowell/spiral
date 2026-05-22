import { useAssetUrl } from "../../hooks/useAssetUrl";
import { playlistUsesCustomImage } from "../../lib/playlistArt";
import type { Playlist } from "../../types/playlist";
import type { Track } from "../../types/track";
import { IconAlbumPlaceholder } from "../icons";
import { PlaylistGeneratedArt } from "./PlaylistGeneratedArt";
import "./PlaylistArt.css";

interface PlaylistArtProps {
  playlist: Playlist;
  tracks?: Track[];
  className?: string;
  alt?: string;
}

export function PlaylistArt({
  playlist,
  tracks: tracksProp,
  className = "",
  alt = "",
}: PlaylistArtProps) {
  const tracks = tracksProp ?? [];

  const useCustom = playlistUsesCustomImage(playlist);

  if (useCustom) {
    return (
      <PlaylistCustomArt
        artPath={playlist.customImagePath!}
        alt={alt || playlist.title}
        className={className}
      />
    );
  }

  return (
    <PlaylistGeneratedArt
      playlistId={playlist.id}
      title={playlist.title}
      tracks={tracks}
      className={className}
      alt={alt || playlist.title}
    />
  );
}

function PlaylistCustomArt({
  artPath,
  alt,
  className = "",
}: {
  artPath: string;
  alt: string;
  className?: string;
}) {
  const src = useAssetUrl(artPath);

  return (
    <div
      className={`playlist-art playlist-art--custom ${className}`.trim()}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
    >
      {src ? (
        <img src={src} alt={alt} className="playlist-art__img" />
      ) : (
        <div className="playlist-art__placeholder" aria-hidden>
          <IconAlbumPlaceholder />
        </div>
      )}
    </div>
  );
}

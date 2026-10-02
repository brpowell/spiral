import type { CSSProperties } from "react";
import { useAssetUrl } from "../../hooks/useAssetUrl";
import { assetUrlFromPath } from "../../lib/assetUrl";
import { cropToFrameStyle, type ImageCrop } from "../../lib/imageCrop";
import { playlistUsesDesignCover } from "../../lib/playlistArt";
import type { Playlist } from "../../types/playlist";
import type { Track } from "../../types/track";
import { IconImage } from "../icons";
import { PlaylistDesignedArt } from "./PlaylistDesignedArt";
import { PlaylistGeneratedArt } from "./PlaylistGeneratedArt";
import "./PlaylistArt.css";

interface PlaylistArtProps {
  playlist: Playlist;
  tracks?: Track[];
  className?: string;
  alt?: string;
  /**
   * Live crop framing for an uncropped source (editor only).
   * Library/sidebar/detail views omit this and show the baked display file.
   */
  imageCrop?: ImageCrop | null;
}

export function PlaylistArt({
  playlist,
  tracks: tracksProp,
  className = "",
  alt = "",
  imageCrop,
}: PlaylistArtProps) {
  const tracks = tracksProp ?? [];

  if (playlist.imageMode === "custom") {
    return (
      <PlaylistCustomArt
        artPath={playlist.customImagePath}
        imageCrop={imageCrop}
        alt={alt || playlist.title}
        className={className}
      />
    );
  }

  if (playlistUsesDesignCover(playlist)) {
    return (
      <PlaylistDesignedArt
        coverBackground={playlist.coverBackground}
        coverBackgroundEnd={playlist.coverBackgroundEnd}
        coverIcon={playlist.coverIcon}
        className={className}
        alt={alt || playlist.title}
      />
    );
  }

  return (
    <PlaylistGeneratedArt
      tracks={tracks}
      className={className}
      alt={alt || playlist.title}
    />
  );
}

function PlaylistCustomArt({
  artPath,
  imageCrop,
  alt,
  className = "",
}: {
  artPath: string | null;
  imageCrop?: ImageCrop | null;
  alt: string;
  className?: string;
}) {
  // Live crop previews a freshly picked file — use sync convertFileSrc so the
  // frame is not blocked on async mtime IPC (same path as ImageCropModal).
  const cachedSrc = useAssetUrl(imageCrop ? null : artPath);
  const src = imageCrop && artPath ? assetUrlFromPath(artPath) : cachedSrc;
  const liveCrop = imageCrop ?? null;
  const frameStyle = liveCrop ? cropToFrameStyle(liveCrop) : null;
  const imgStyle: CSSProperties | undefined = frameStyle
    ? {
        width: frameStyle.width,
        height: frameStyle.height,
        left: frameStyle.left,
        top: frameStyle.top,
        position: "absolute",
        maxWidth: "none",
        maxHeight: "none",
        objectFit: "fill",
      }
    : undefined;

  return (
    <div
      className={`playlist-art playlist-art--custom ${className}`.trim()}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          className={
            frameStyle
              ? "playlist-art__img playlist-art__img--cropped"
              : "playlist-art__img"
          }
          style={imgStyle}
        />
      ) : (
        <div className="playlist-art__placeholder" aria-hidden>
          <IconImage />
        </div>
      )}
    </div>
  );
}

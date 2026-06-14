import type { ReactNode } from "react";
import { IconAlbumPlaceholder } from "../icons";
import { useEntityArtSrc } from "./useEntityArtSrc";
import "./EntityArt.css";

interface EntityArtProps {
  artPath: string | null;
  alt?: string;
  className?: string;
  /** Optional custom placeholder when there is no art path. */
  placeholder?: ReactNode;
  /** Row uses a cached JPEG thumbnail generated in Rust. */
  variant?: "default" | "row";
}

export function EntityArt({
  artPath,
  alt = "",
  className = "",
  placeholder,
  variant = "default",
}: EntityArtProps) {
  const src = useEntityArtSrc(artPath, variant);

  return (
    <div className={`album-art ${className}`.trim()}>
      {src ? (
        <img
          src={src}
          alt={alt}
          className="album-art__img"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="album-art__placeholder" aria-hidden>
          {placeholder ?? <IconAlbumPlaceholder />}
        </div>
      )}
    </div>
  );
}

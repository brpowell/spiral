import type { ReactNode } from "react";
import { IconDisc2 } from "../icons";
import { useEntityArtSrc, type EntityArtVariant } from "./useEntityArtSrc";
import "./EntityArt.css";

interface EntityArtProps {
  artPath: string | null;
  alt?: string;
  className?: string;
  /** Optional custom placeholder when there is no art path. */
  placeholder?: ReactNode;
  /** Row/grid use cached JPEG thumbnails generated in Rust. */
  variant?: EntityArtVariant;
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
          {placeholder ?? <IconDisc2 />}
        </div>
      )}
    </div>
  );
}

import type { ReactNode } from "react";
import { useAssetUrl } from "../../hooks/useAssetUrl";
import { IconAlbumPlaceholder } from "../icons";
import "./EntityArt.css";

interface EntityArtProps {
  artPath: string | null;
  alt?: string;
  className?: string;
  /** Optional custom placeholder when there is no art path. */
  placeholder?: ReactNode;
}

export function EntityArt({
  artPath,
  alt = "",
  className = "",
  placeholder,
}: EntityArtProps) {
  const src = useAssetUrl(artPath);

  return (
    <div className={`album-art ${className}`.trim()}>
      {src ? (
        <img src={src} alt={alt} className="album-art__img" />
      ) : (
        <div className="album-art__placeholder" aria-hidden>
          {placeholder ?? <IconAlbumPlaceholder />}
        </div>
      )}
    </div>
  );
}

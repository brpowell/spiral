import { useAssetUrl } from "../../hooks/useAssetUrl";
import { IconAlbumPlaceholder } from "../icons";
import "./AlbumArt.css";

interface AlbumArtProps {
  artPath: string | null;
  alt?: string;
  className?: string;
}

export function AlbumArt({ artPath, alt = "", className = "" }: AlbumArtProps) {
  const src = useAssetUrl(artPath);

  return (
    <div className={`album-art ${className}`.trim()}>
      {src ? (
        <img src={src} alt={alt} className="album-art__img" />
      ) : (
        <div className="album-art__placeholder" aria-hidden>
          <IconAlbumPlaceholder />
        </div>
      )}
    </div>
  );
}

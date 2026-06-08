import { useCallback, useMemo } from "react";
import { useAssetUrl } from "../../../hooks/useAssetUrl";
import { albumKey } from "../../../lib/albums";
import { useNavigationStore } from "../../../store/useNavigationStore";
import { usePlayerStore } from "../../../store/usePlayerStore";
import { ScrollingText } from "../../ScrollingText/ScrollingText";
import { IconAlbumPlaceholder } from "../../icons";
import "./NowPlayingMetadata.css";

interface NowPlayingMetadataProps {
  className?: string;
  showArt?: boolean;
  showText?: boolean;
  /** When set, art click invokes this instead of default album navigation. */
  onArtClick?: () => void;
}

export function NowPlayingMetadata({
  className,
  showArt = true,
  showText = true,
  onArtClick,
}: NowPlayingMetadataProps) {
  const library = usePlayerStore((s) => s.library);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const openAlbum = useNavigationStore((s) => s.openAlbum);

  const currentTrack = useMemo(
    () => library.find((t) => t.id === currentTrackId),
    [library, currentTrackId],
  );

  const artSrc = useAssetUrl(currentTrack?.artPath);

  const subtitle = currentTrack
    ? [currentTrack.artist, currentTrack.album].filter(Boolean).join(" — ")
    : null;

  const handleArtClick = useCallback(() => {
    if (onArtClick) {
      onArtClick();
      return;
    }
    if (currentTrack) {
      openAlbum(albumKey(currentTrack));
    }
  }, [currentTrack, onArtClick, openAlbum]);

  const artLabel = currentTrack?.album
    ? `View album ${currentTrack.album}`
    : "View album";

  return (
    <div
      className={["now-playing-metadata", className].filter(Boolean).join(" ")}
    >
      {showArt ? (
        <button
          type="button"
          className="now-playing-metadata__art"
          onClick={handleArtClick}
          disabled={!currentTrack}
          aria-label={artLabel}
        >
          {artSrc ? (
            <img
              src={artSrc}
              alt=""
              className="now-playing-metadata__art-img"
            />
          ) : (
            <div className="now-playing-metadata__art-placeholder" aria-hidden>
              <IconAlbumPlaceholder />
            </div>
          )}
        </button>
      ) : null}

      {showText ? (
        <div className="now-playing-metadata__text">
          <ScrollingText
            className="now-playing-metadata__title"
            text={currentTrack?.title ?? "No track selected"}
          />
          <ScrollingText
            className="now-playing-metadata__subtitle"
            text={subtitle ?? "Unknown artist"}
          />
        </div>
      ) : null}
    </div>
  );
}

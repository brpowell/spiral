import { LayoutGroup, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAssetUrl } from "../../../hooks/useAssetUrl";
import { findPlaybackTrack } from "../../../lib/playbackTrack";
import { usePlayerStore } from "../../../store/usePlayerStore";
import {
  AlbumArtLightbox,
  albumArtLayoutTransition,
  NOW_PLAYING_ART_LAYOUT_ID,
} from "../../AlbumArtLightbox/AlbumArtLightbox";
import { ScrollingText } from "../../ScrollingText/ScrollingText";
import { IconAlbumPlaceholder } from "../../icons";
import "./NowPlayingMetadata.css";

interface NowPlayingMetadataProps {
  className?: string;
  showArt?: boolean;
  showText?: boolean;
}

export function NowPlayingMetadata({
  className,
  showArt = true,
  showText = true,
}: NowPlayingMetadataProps) {
  const library = usePlayerStore((s) => s.library);
  const playbackTracks = usePlayerStore((s) => s.playbackTracks);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const [artOpen, setArtOpen] = useState(false);

  const currentTrack = useMemo(
    () =>
      findPlaybackTrack({ library, playbackTracks, currentTrackId }),
    [library, playbackTracks, currentTrackId],
  );

  const artSrc = useAssetUrl(currentTrack?.artPath);

  const subtitle = currentTrack
    ? [currentTrack.artist, currentTrack.album].filter(Boolean).join(" — ")
    : null;

  useEffect(() => {
    setArtOpen(false);
  }, [currentTrackId]);

  const handleArtClick = useCallback(() => {
    if (artSrc) {
      setArtOpen(true);
    }
  }, [artSrc]);

  const artLabel = currentTrack?.album
    ? `View album art for ${currentTrack.album}`
    : "View album art";

  return (
    <LayoutGroup>
      <div
        className={["now-playing-metadata", className].filter(Boolean).join(" ")}
      >
        {showArt ? (
          artSrc ? (
            <motion.button
              type="button"
              className="now-playing-metadata__art"
              layoutId={NOW_PLAYING_ART_LAYOUT_ID}
              transition={albumArtLayoutTransition}
              onClick={handleArtClick}
              disabled={!currentTrack}
              aria-label={artLabel}
            >
              <img
                src={artSrc}
                alt=""
                className="now-playing-metadata__art-img"
              />
            </motion.button>
          ) : (
            <button
              type="button"
              className="now-playing-metadata__art"
              onClick={handleArtClick}
              disabled={!currentTrack}
              aria-label={artLabel}
            >
              <div
                className="now-playing-metadata__art-placeholder"
                aria-hidden
              >
                <IconAlbumPlaceholder />
              </div>
            </button>
          )
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

      {artSrc ? (
        <AlbumArtLightbox
          open={artOpen}
          onClose={() => setArtOpen(false)}
          artSrc={artSrc}
          alt={currentTrack?.album ?? ""}
          caption={subtitle ?? undefined}
        />
      ) : null}
    </LayoutGroup>
  );
}

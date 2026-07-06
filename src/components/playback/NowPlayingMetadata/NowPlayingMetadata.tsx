import { LayoutGroup, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAssetUrl } from "../../../hooks/useAssetUrl";
import { findPlaybackTrack } from "../../../lib/playbackTrack";
import { usePlaybackSettingsStore } from "../../../store/usePlaybackSettingsStore";
import { usePlayerStore } from "../../../store/usePlayerStore";
import type { Track } from "../../../types/track";
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

function trackSubtitle(track: Track | undefined): string | null {
  if (!track) return null;
  return [track.artist, track.album].filter(Boolean).join(" — ");
}

function CrossfadeOpacity({
  progress,
  role,
  reduceMotion,
  children,
}: {
  progress: number;
  role: "outgoing" | "incoming";
  reduceMotion: boolean;
  children: ReactNode;
}) {
  if (reduceMotion) {
    const showIncoming = progress >= 0.5;
    const visible =
      role === "incoming" ? showIncoming : !showIncoming;
    if (!visible) return null;
    return <>{children}</>;
  }

  const opacity = role === "incoming" ? progress : 1 - progress;
  if (opacity <= 0.01) return null;

  return (
    <div
      className="now-playing-metadata__crossfade-layer"
      style={{ opacity }}
      aria-hidden={opacity < 0.5}
    >
      {children}
    </div>
  );
}

function AlbumArtImage({ src }: { src: string }) {
  return (
    <img src={src} alt="" className="now-playing-metadata__art-img" />
  );
}

function AlbumArtPlaceholder({ inactive }: { inactive?: boolean }) {
  return (
    <div
      className={[
        "now-playing-metadata__art",
        inactive && "now-playing-metadata__art--inactive",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden
    >
      <div className="now-playing-metadata__art-placeholder" aria-hidden>
        <IconAlbumPlaceholder />
      </div>
    </div>
  );
}

export function NowPlayingMetadata({
  className,
  showArt = true,
  showText = true,
}: NowPlayingMetadataProps) {
  const library = usePlayerStore((s) => s.library);
  const playbackTracks = usePlayerStore((s) => s.playbackTracks);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const crossfadeVisual = usePlayerStore((s) => s.crossfadeVisual);
  const crossfadeVisualEnabled = usePlaybackSettingsStore(
    (s) => s.crossfadeVisualEnabled,
  );
  const showCrossfadeVisual =
    crossfadeVisual !== null && crossfadeVisualEnabled;
  const crossfadeProgress = crossfadeVisual?.progress ?? 0;
  const [artOpen, setArtOpen] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const currentTrack = useMemo(
    () =>
      findPlaybackTrack({ library, playbackTracks, currentTrackId }),
    [library, playbackTracks, currentTrackId],
  );

  const outgoingTrack = useMemo(
    () =>
      showCrossfadeVisual && crossfadeVisual
        ? findPlaybackTrack({
            library,
            playbackTracks,
            currentTrackId: crossfadeVisual.outgoingTrackId,
          })
        : undefined,
    [showCrossfadeVisual, crossfadeVisual, library, playbackTracks],
  );

  const incomingTrack = useMemo(
    () =>
      showCrossfadeVisual && crossfadeVisual
        ? findPlaybackTrack({
            library,
            playbackTracks,
            currentTrackId: crossfadeVisual.incomingTrackId,
          })
        : undefined,
    [showCrossfadeVisual, crossfadeVisual, library, playbackTracks],
  );

  const displayTrack = showCrossfadeVisual
    ? crossfadeProgress >= 0.5
      ? (incomingTrack ?? currentTrack)
      : (outgoingTrack ?? currentTrack)
    : currentTrack;

  const outgoingArtSrc = useAssetUrl(
    showCrossfadeVisual ? outgoingTrack?.artPath : null,
  );
  const incomingArtSrc = useAssetUrl(
    showCrossfadeVisual ? incomingTrack?.artPath : null,
  );
  const metadataTrack = showCrossfadeVisual ? displayTrack : currentTrack;
  const artSrc = useAssetUrl(metadataTrack?.artPath);

  const subtitle = trackSubtitle(metadataTrack);

  useEffect(() => {
    setArtOpen(false);
  }, [currentTrackId]);

  const handleArtClick = useCallback(() => {
    if (artSrc && !showCrossfadeVisual) {
      setArtOpen(true);
    }
  }, [artSrc, showCrossfadeVisual]);

  const artLabel = metadataTrack?.album
    ? `View album art for ${metadataTrack.album}`
    : "View album art";

  const renderArt = () => {
    if (!showArt) return null;

    if (showCrossfadeVisual && (outgoingArtSrc || incomingArtSrc)) {
      return (
        <button
          type="button"
          className="now-playing-metadata__art"
          disabled
          aria-label="Crossfading between tracks"
        >
          <div className="now-playing-metadata__art-stack">
            {outgoingArtSrc ? (
              <CrossfadeOpacity
                progress={crossfadeProgress}
                role="outgoing"
                reduceMotion={reduceMotion}
              >
                <AlbumArtImage src={outgoingArtSrc} />
              </CrossfadeOpacity>
            ) : null}
            {incomingArtSrc ? (
              <CrossfadeOpacity
                progress={crossfadeProgress}
                role="incoming"
                reduceMotion={reduceMotion}
              >
                <AlbumArtImage src={incomingArtSrc} />
              </CrossfadeOpacity>
            ) : null}
          </div>
        </button>
      );
    }

    if (artSrc) {
      return (
        <motion.button
          type="button"
          className="now-playing-metadata__art now-playing-metadata__art--zoomable"
          layoutId={NOW_PLAYING_ART_LAYOUT_ID}
          transition={albumArtLayoutTransition}
          onClick={handleArtClick}
          disabled={!currentTrack}
          aria-label={artLabel}
        >
          <AlbumArtImage src={artSrc} />
        </motion.button>
      );
    }

    return <AlbumArtPlaceholder inactive={!currentTrack} />;
  };

  const renderTextLayer = (
    track: Track | undefined,
    fallbackTitle: string,
    fallbackSubtitle: string,
  ) => (
    <>
      <ScrollingText
        className="now-playing-metadata__title"
        text={track?.title ?? fallbackTitle}
      />
      <ScrollingText
        className="now-playing-metadata__subtitle"
        text={trackSubtitle(track) ?? fallbackSubtitle}
      />
    </>
  );

  const renderText = () => {
    if (!showText) return null;

    const sizerTrack = showCrossfadeVisual
      ? (outgoingTrack ?? incomingTrack ?? currentTrack)
      : currentTrack;

    return (
      <div className="now-playing-metadata__text">
        <div className="now-playing-metadata__text-sizer" aria-hidden>
          {renderTextLayer(sizerTrack, "No track selected", "Unknown artist")}
        </div>
        <div className="now-playing-metadata__text-overlay">
          {showCrossfadeVisual && (outgoingTrack || incomingTrack) ? (
            <>
              <CrossfadeOpacity
                progress={crossfadeProgress}
                role="outgoing"
                reduceMotion={reduceMotion}
              >
                {renderTextLayer(
                  outgoingTrack,
                  "No track selected",
                  "Unknown artist",
                )}
              </CrossfadeOpacity>
              <CrossfadeOpacity
                progress={crossfadeProgress}
                role="incoming"
                reduceMotion={reduceMotion}
              >
                {renderTextLayer(
                  incomingTrack,
                  "No track selected",
                  "Unknown artist",
                )}
              </CrossfadeOpacity>
            </>
          ) : (
            renderTextLayer(currentTrack, "No track selected", "Unknown artist")
          )}
        </div>
      </div>
    );
  };

  return (
    <LayoutGroup>
      <div
        className={[
          "now-playing-metadata",
          showCrossfadeVisual && "now-playing-metadata--crossfading",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {renderArt()}
        {renderText()}
      </div>

      {artSrc && !showCrossfadeVisual ? (
        <AlbumArtLightbox
          open={artOpen}
          onClose={() => setArtOpen(false)}
          artSrc={artSrc}
          alt={metadataTrack?.album ?? ""}
          caption={subtitle ?? undefined}
        />
      ) : null}
    </LayoutGroup>
  );
}

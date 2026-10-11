import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import {
  releasedOutsidePanel,
  shouldDismissModalOnBackdropRelease,
} from "../../lib/modalBackdropDismiss";
import { lightboxCompanionMotionProps } from "../../lib/motion";
import type { LyricsFetchFeedback } from "../../lib/lyricsFetch";
import type { TrackLyrics } from "../../types/lyrics";
import {
  LyricsEmptyPanel,
  LyricsLoadingPanel,
  LyricsPanel,
} from "./LyricsPanel";
import "./AlbumArtLightbox.css";

export const NOW_PLAYING_ART_LAYOUT_ID = "now-playing-album-art";

export const albumArtLayoutTransition = {
  type: "spring" as const,
  stiffness: 380,
  damping: 34,
};

/** Matches `--radius-sm` / `--radius-card` for Motion scale correction. */
export const NOW_PLAYING_ART_RADIUS = 8;
export const LIGHTBOX_ART_RADIUS = 12;

interface AlbumArtLightboxProps {
  open: boolean;
  onClose: () => void;
  artSrc: string;
  alt?: string;
  title?: string;
  caption?: string;
  lyrics?: TrackLyrics | null;
  lyricsLoading?: boolean;
  reduceMotion?: boolean;
  canFetchLyrics?: boolean;
  fetchingLyrics?: boolean;
  lyricsFetchFeedback?: LyricsFetchFeedback | null;
  onFetchLyrics?: () => void;
  onAddLyricsManually?: () => void;
  /** When false, Escape / backdrop / art click do not close. Default true. */
  dismissible?: boolean;
}

export function AlbumArtLightbox({
  open,
  onClose,
  artSrc,
  alt = "",
  title,
  caption,
  lyrics,
  lyricsLoading = false,
  reduceMotion = false,
  canFetchLyrics = false,
  fetchingLyrics = false,
  lyricsFetchFeedback = null,
  onFetchLyrics,
  onAddLyricsManually,
  dismissible = true,
}: AlbumArtLightboxProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !dismissible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, dismissible]);

  useEffect(() => {
    if (!open || !dismissible) return;

    let pressedOutsidePanel = false;

    const onMouseDown = (e: MouseEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      pressedOutsidePanel = !panel.contains(e.target as Node);
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return;

      const backdrop = backdropRef.current;
      const panel = panelRef.current;
      if (!backdrop || !panel) return;

      const target = e.target as Node;
      if (
        shouldDismissModalOnBackdropRelease(
          pressedOutsidePanel,
          releasedOutsidePanel(backdrop, panel, target),
        )
      ) {
        onClose();
      }
      pressedOutsidePanel = false;
    };

    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mouseup", onMouseUp, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mouseup", onMouseUp, true);
    };
  }, [open, onClose, dismissible]);

  const displayLyrics = lyrics && lyrics.plainText.trim() ? lyrics : null;
  const showLyricsColumn =
    displayLyrics != null ||
    lyricsLoading ||
    fetchingLyrics ||
    canFetchLyrics ||
    lyricsFetchFeedback != null;
  const showTrackInfo = Boolean(title?.trim() || caption?.trim());
  const companionMotion = lightboxCompanionMotionProps(reduceMotion);

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="album-art-lightbox"
          ref={backdropRef}
          className="album-art-lightbox"
          layoutRoot
          initial={false}
          animate={{ opacity: 1 }}
          exit={{
            opacity: 1,
            transition: { delay: 0.22 },
          }}
        >
          <motion.div
            className="album-art-lightbox__scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{
              opacity: 0,
              transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
            }}
            aria-hidden
          />
          <div
            ref={panelRef}
            className={[
              "album-art-lightbox__panel",
              showLyricsColumn && "album-art-lightbox__panel--with-lyrics",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="album-art-lightbox__art-column">
              <motion.button
                type="button"
                className="album-art-lightbox__art"
                layoutId={NOW_PLAYING_ART_LAYOUT_ID}
                layoutCrossfade={false}
                transition={albumArtLayoutTransition}
                style={{ borderRadius: LIGHTBOX_ART_RADIUS }}
                onClick={(e: MouseEvent<HTMLButtonElement>) => {
                  e.stopPropagation();
                  if (!dismissible) return;
                  onClose();
                }}
                aria-label={alt ? `Close ${alt} album art` : "Close album art"}
              >
                <img
                  src={artSrc}
                  alt={alt}
                  className="album-art-lightbox__img"
                  draggable={false}
                />
              </motion.button>
              {showTrackInfo ? (
                <motion.div
                  className="album-art-lightbox__track-info"
                  {...companionMotion}
                >
                  {title?.trim() ? (
                    <p className="album-art-lightbox__track-title">{title}</p>
                  ) : null}
                  {caption?.trim() ? (
                    <p className="album-art-lightbox__track-subtitle">
                      {caption}
                    </p>
                  ) : null}
                </motion.div>
              ) : null}
            </div>
            {displayLyrics ? (
              <LyricsPanel
                lyrics={displayLyrics}
                reduceMotion={reduceMotion}
                companionMotion={companionMotion}
              />
            ) : lyricsLoading || fetchingLyrics ? (
              <LyricsLoadingPanel companionMotion={companionMotion} />
            ) : (canFetchLyrics || lyricsFetchFeedback) && onFetchLyrics ? (
              <LyricsEmptyPanel
                onFetchLyrics={onFetchLyrics}
                onAddManually={onAddLyricsManually}
                companionMotion={companionMotion}
                feedback={lyricsFetchFeedback}
              />
            ) : null}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

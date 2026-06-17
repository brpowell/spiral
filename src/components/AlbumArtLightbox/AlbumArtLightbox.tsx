import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import {
  releasedOutsidePanel,
  shouldDismissModalOnBackdropRelease,
} from "../../lib/modalBackdropDismiss";
import "./AlbumArtLightbox.css";

export const NOW_PLAYING_ART_LAYOUT_ID = "now-playing-album-art";

export const albumArtLayoutTransition = {
  type: "spring" as const,
  stiffness: 380,
  damping: 34,
};

interface AlbumArtLightboxProps {
  open: boolean;
  onClose: () => void;
  artSrc: string;
  alt?: string;
  caption?: string;
}

export function AlbumArtLightbox({
  open,
  onClose,
  artSrc,
  alt = "",
  caption,
}: AlbumArtLightboxProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [showCaption, setShowCaption] = useState(open);

  const requestClose = useCallback(() => {
    setShowCaption(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (open) setShowCaption(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, requestClose]);

  useEffect(() => {
    if (!open) return;

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
        requestClose();
      }
      pressedOutsidePanel = false;
    };

    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mouseup", onMouseUp, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mouseup", onMouseUp, true);
    };
  }, [open, requestClose]);

  return createPortal(
    <>
      <AnimatePresence>
        {open ? (
          <motion.div
            key="album-art-lightbox"
            ref={backdropRef}
            className="album-art-lightbox"
            layoutRoot
            initial={false}
            animate={{ opacity: 1 }}
            exit={{ opacity: 1 }}
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
            <div ref={panelRef} className="album-art-lightbox__panel">
              <div className="album-art-lightbox__art-shadow">
                <motion.button
                  type="button"
                  className="album-art-lightbox__art"
                  layoutId={NOW_PLAYING_ART_LAYOUT_ID}
                  transition={albumArtLayoutTransition}
                  onClick={(e: MouseEvent<HTMLButtonElement>) => {
                    e.stopPropagation();
                    requestClose();
                  }}
                  aria-label={alt ? `Close ${alt} album art` : "Close album art"}
                >
                  <img
                    src={artSrc}
                    alt={alt}
                    className="album-art-lightbox__img"
                  />
                </motion.button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {showCaption && caption ? (
          <motion.div
            key="album-art-lightbox-caption"
            className="album-art-lightbox__caption-anchor"
            initial={{ opacity: 0, x: "-50%", y: 6 }}
            animate={{
              opacity: 1,
              x: "-50%",
              y: 0,
              transition: { duration: 0.14, delay: 0.06 },
            }}
            exit={{
              opacity: 0,
              x: "-50%",
              y: 6,
              transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
            }}
          >
            <p className="album-art-lightbox__caption">{caption}</p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>,
    document.body,
  );
}

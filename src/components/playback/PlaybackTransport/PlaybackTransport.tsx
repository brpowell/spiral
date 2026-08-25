import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { buildPlaybackOrder } from "../../../lib/playbackOrder";
import { getManualNextId } from "../../../lib/playbackQueue";
import { getNextSkippingKnownUnplayable } from "../../../lib/playbackSkip";
import { isTrackImporting } from "../../../lib/pendingImportTrack";
import { usePlayerStore } from "../../../store/usePlayerStore";
import type { RepeatMode } from "../../../types/track";
import { Button } from "../../common/Button/Button";
import {
  IconNext,
  IconPause,
  IconPlay,
  IconPrevious,
  IconRepeat,
  IconRepeatOne,
  IconShuffle,
} from "../../icons";
import "../playbackControl.css";
import "./PlaybackTransport.css";

interface PlaybackTransportProps {
  className?: string;
  nodeId?: string;
  interactionEnabled?: boolean;
}

const REPEAT_LABEL_KEYS: Record<
  RepeatMode,
  "transport.repeatOff" | "transport.repeatAll" | "transport.repeatOne"
> = {
  off: "transport.repeatOff",
  all: "transport.repeatAll",
  one: "transport.repeatOne",
};

export function PlaybackTransport({
  className,
  nodeId,
  interactionEnabled = true,
}: PlaybackTransportProps) {
  const { t } = useTranslation("playback");
  const library = usePlayerStore((s) => s.library);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const playContextIds = usePlayerStore((s) => s.playContextIds);
  const manualQueueIds = usePlayerStore((s) => s.manualQueueIds);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const togglePlayPause = usePlayerStore((s) => s.togglePlayPause);
  const previousTrack = usePlayerStore((s) => s.previousTrack);
  const nextTrack = usePlayerStore((s) => s.nextTrack);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);

  const activeQueue = useMemo(
    () =>
      buildPlaybackOrder(
        manualQueueIds,
        playContextIds,
        library,
        currentTrackId,
      ),
    [manualQueueIds, playContextIds, library, currentTrackId],
  );

  const canPlay =
    currentTrackId !== null ||
    library.some((track) => !isTrackImporting(track));

  const canGoPrevious = currentTrackId !== null;

  const canGoNext =
    currentTrackId !== null &&
    activeQueue.length > 0 &&
    getNextSkippingKnownUnplayable(
      activeQueue,
      currentTrackId,
      repeatMode,
      library,
      getManualNextId,
    ) !== null;

  const handlePlayPause = useCallback(() => {
    togglePlayPause();
  }, [togglePlayPause]);

  return (
    <div
      className={["playback-transport", className].filter(Boolean).join(" ")}
      data-node-id={nodeId}
      aria-disabled={interactionEnabled ? undefined : true}
      style={interactionEnabled ? undefined : { pointerEvents: "none" }}
    >
      <Button
        variant="ghost"
        size="md"
        iconOnly
        className={`playback-btn playback-btn--shuffle${shuffle ? " playback-btn--shuffle-active" : ""}`}
        onClick={toggleShuffle}
        aria-label={
          shuffle ? t("transport.shuffleOff") : t("transport.shuffleOn")
        }
        title={shuffle ? t("transport.shuffleOff") : t("transport.shuffleOn")}
      >
        <IconShuffle />
      </Button>

      <Button
        variant="ghost"
        size="md"
        iconOnly
        className="playback-btn"
        onClick={previousTrack}
        disabled={!canGoPrevious}
        aria-label={t("transport.previous")}
      >
        <IconPrevious />
      </Button>

      <Button
        variant="primary"
        size="md"
        iconOnly
        className="playback-btn playback-btn--play"
        onClick={handlePlayPause}
        disabled={!canPlay}
        aria-label={
          playbackState === "playing"
            ? t("transport.pause")
            : t("transport.play")
        }
      >
        <AnimatePresence mode="wait" initial={false}>
          {playbackState === "playing" ? (
            <motion.span
              key="pause"
              className="playback-btn__play-icon"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <IconPause />
            </motion.span>
          ) : (
            <motion.span
              key="play"
              className="playback-btn__play-icon"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <IconPlay />
            </motion.span>
          )}
        </AnimatePresence>
      </Button>

      <Button
        variant="ghost"
        size="md"
        iconOnly
        className="playback-btn"
        onClick={nextTrack}
        disabled={!canGoNext}
        aria-label={t("transport.next")}
      >
        <IconNext />
      </Button>

      <Button
        variant="ghost"
        size="md"
        iconOnly
        className={`playback-btn playback-btn--repeat${repeatMode !== "off" ? " playback-btn--repeat-active" : ""}`}
        onClick={cycleRepeat}
        aria-label={t(REPEAT_LABEL_KEYS[repeatMode])}
        title={t(REPEAT_LABEL_KEYS[repeatMode])}
      >
        {repeatMode === "one" ? <IconRepeatOne /> : <IconRepeat />}
      </Button>
    </div>
  );
}

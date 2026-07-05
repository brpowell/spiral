import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useMemo } from "react";
import { buildPlaybackOrder } from "../../../lib/playbackOrder";
import { getManualNextId } from "../../../lib/playbackQueue";
import { getNextSkippingKnownUnplayable } from "../../../lib/playbackSkip";
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
}

const repeatLabel: Record<RepeatMode, string> = {
  off: "Repeat off",
  all: "Repeat all",
  one: "Repeat one",
};

export function PlaybackTransport({ className }: PlaybackTransportProps) {
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
    >
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        className={`playback-btn playback-btn--shuffle${shuffle ? " playback-btn--shuffle-active" : ""}`}
        onClick={toggleShuffle}
        aria-label={shuffle ? "Turn shuffle off" : "Turn shuffle on"}
        title={shuffle ? "Turn shuffle off" : "Turn shuffle on"}
      >
        <IconShuffle />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        iconOnly
        className="playback-btn"
        onClick={previousTrack}
        disabled={!canGoPrevious}
        aria-label="Previous track"
      >
        <IconPrevious />
      </Button>

      <Button
        variant="primary"
        size="sm"
        iconOnly
        className="playback-btn playback-btn--play"
        onClick={handlePlayPause}
        disabled={!currentTrackId}
        aria-label={playbackState === "playing" ? "Pause" : "Play"}
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
        size="sm"
        iconOnly
        className="playback-btn"
        onClick={nextTrack}
        disabled={!canGoNext}
        aria-label="Next track"
      >
        <IconNext />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        iconOnly
        className={`playback-btn playback-btn--repeat${repeatMode !== "off" ? " playback-btn--repeat-active" : ""}`}
        onClick={cycleRepeat}
        aria-label={repeatLabel[repeatMode]}
        title={repeatLabel[repeatMode]}
      >
        {repeatMode === "one" ? <IconRepeatOne /> : <IconRepeat />}
      </Button>
    </div>
  );
}

import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { playTransportCue } from "../../../lib/transportCues";
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

const REPEAT_LABEL_KEYS: Record<
  RepeatMode,
  "transport.repeatOff" | "transport.repeatAll" | "transport.repeatOne"
> = {
  off: "transport.repeatOff",
  all: "transport.repeatAll",
  one: "transport.repeatOne",
};

export interface TransportButtonsProps {
  className?: string;
  nodeId?: string;
  interactionEnabled?: boolean;
  shuffle: boolean;
  repeatMode: RepeatMode;
  playing: boolean;
  canPlay: boolean;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onShuffle: () => void;
  onPrevious: () => void;
  onPlayPause: () => void;
  onNext: () => void;
  onRepeat: () => void;
}

/**
 * The transport's buttons, driven entirely by props. `PlaybackTransport` wires
 * them to the player; other screens (like the onboarding preview) can drive
 * them with local state. Every press plays its cue.
 */
export function TransportButtons({
  className,
  nodeId,
  interactionEnabled = true,
  shuffle,
  repeatMode,
  playing,
  canPlay,
  canGoPrevious,
  canGoNext,
  onShuffle,
  onPrevious,
  onPlayPause,
  onNext,
  onRepeat,
}: TransportButtonsProps) {
  const { t } = useTranslation("playback");
  const handlePlayPause = () => {
    playTransportCue(playing ? "control" : "play");
    onPlayPause();
  };

  return (
    <div
      className={["playback-transport", className].filter(Boolean).join(" ")}
      data-node-id={nodeId}
      aria-disabled={interactionEnabled ? undefined : true}
      style={interactionEnabled ? undefined : { pointerEvents: "none" }}
    >
      <Button
        variant="secondary"
        size="md"
        iconOnly
        className={`playback-btn playback-btn--shuffle${shuffle ? " playback-btn--shuffle-active" : ""}`}
        onClick={() => {
          playTransportCue("control");
          onShuffle();
        }}
        aria-label={
          shuffle ? t("transport.shuffleOff") : t("transport.shuffleOn")
        }
        title={shuffle ? t("transport.shuffleOff") : t("transport.shuffleOn")}
      >
        <IconShuffle />
      </Button>

      <Button
        variant="secondary"
        size="md"
        iconOnly
        className="playback-btn"
        onClick={() => {
          playTransportCue("control");
          onPrevious();
        }}
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
        aria-label={playing ? t("transport.pause") : t("transport.play")}
      >
        <AnimatePresence mode="wait" initial={false}>
          {playing ? (
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
        variant="secondary"
        size="md"
        iconOnly
        className="playback-btn"
        onClick={() => {
          playTransportCue("control");
          onNext();
        }}
        disabled={!canGoNext}
        aria-label={t("transport.next")}
      >
        <IconNext />
      </Button>

      <Button
        variant="secondary"
        size="md"
        iconOnly
        className={`playback-btn playback-btn--repeat${repeatMode !== "off" ? " playback-btn--repeat-active" : ""}`}
        onClick={() => {
          playTransportCue("control");
          onRepeat();
        }}
        aria-label={t(REPEAT_LABEL_KEYS[repeatMode])}
        title={t(REPEAT_LABEL_KEYS[repeatMode])}
      >
        {repeatMode === "one" ? <IconRepeatOne /> : <IconRepeat />}
      </Button>
    </div>
  );
}

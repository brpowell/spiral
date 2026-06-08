import { useMemo } from "react";
import { Slider } from "../../common/Slider/Slider";
import * as audio from "../../../lib/audio";
import { formatRemainingTime, formatTime } from "../../../lib/format";
import { usePlaybackProgress } from "../../../hooks/usePlaybackProgress";
import { usePlayerStore } from "../../../store/usePlayerStore";
import "./SeekBar.css";

interface SeekBarProps {
  className?: string;
}

export function SeekBar({ className }: SeekBarProps) {
  const library = usePlayerStore((s) => s.library);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);

  const currentTrack = useMemo(
    () => library.find((t) => t.id === currentTrackId),
    [library, currentTrackId],
  );

  const durationSeconds =
    currentTrack?.durationSeconds ?? audio.getDurationSeconds();

  const {
    isSeeking,
    seekValue,
    progress,
    displayPosition,
    disabled,
    handleSeekStart,
    handleSeekChange,
    handleSeekEnd,
  } = usePlaybackProgress(durationSeconds);

  return (
    <div className={["seek-bar", className].filter(Boolean).join(" ")}>
      <span className="seek-bar__time">{formatTime(displayPosition)}</span>
      <Slider
        className="seek-bar__slider"
        min={0}
        max={1}
        step={0.001}
        value={isSeeking ? seekValue : progress}
        disabled={disabled}
        aria-label="Seek"
        onPointerDown={handleSeekStart}
        onChange={(e) => handleSeekChange(Number(e.currentTarget.value))}
        onPointerUp={(e) => handleSeekEnd(Number(e.currentTarget.value))}
        onKeyUp={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            handleSeekEnd(Number(e.currentTarget.value));
          }
        }}
      />
      <span className="seek-bar__time seek-bar__time--remaining">
        {formatRemainingTime(displayPosition, durationSeconds)}
      </span>
    </div>
  );
}

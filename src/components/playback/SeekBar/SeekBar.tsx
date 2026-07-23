import { useMemo, type KeyboardEvent, type PointerEvent } from "react";
import { Slider } from "../../common/Slider/Slider";
import * as audio from "../../../lib/playback";
import { formatRemainingTime, formatTime } from "../../../lib/format";
import { findPlaybackTrack } from "../../../lib/playbackTrack";
import { usePlaybackProgress } from "../../../hooks/usePlaybackProgress";
import { usePlayerStore } from "../../../store/usePlayerStore";
import "./SeekBar.css";

interface SeekBarProps {
  className?: string;
}

function isSeekKey(key: string): boolean {
  return (
    key === "ArrowLeft" ||
    key === "ArrowRight" ||
    key === "ArrowUp" ||
    key === "ArrowDown" ||
    key === "Home" ||
    key === "End" ||
    key === "PageUp" ||
    key === "PageDown"
  );
}

export function SeekBar({ className }: SeekBarProps) {
  const library = usePlayerStore((s) => s.library);
  const playbackTracks = usePlayerStore((s) => s.playbackTracks);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);

  const currentTrack = useMemo(
    () =>
      findPlaybackTrack({ library, playbackTracks, currentTrackId }),
    [library, playbackTracks, currentTrackId],
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

  const finishPointer = (e: PointerEvent<HTMLInputElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    handleSeekEnd(Number(e.currentTarget.value));
  };

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
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          handleSeekStart();
        }}
        onChange={(e) => handleSeekChange(Number(e.currentTarget.value))}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (isSeekKey(e.key)) handleSeekStart();
        }}
        onKeyUp={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter" || e.key === " " || isSeekKey(e.key)) {
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

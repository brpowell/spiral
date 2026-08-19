import { useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { Slider } from "../../common/Slider/Slider";
import * as audio from "../../../lib/playback";
import { formatRemainingTime, formatTime } from "../../../lib/format";
import { t } from "../../../lib/i18n";
import { findPlaybackTrack } from "../../../lib/playbackTrack";
import { usePlaybackProgress } from "../../../hooks/usePlaybackProgress";
import { usePlayerStore } from "../../../store/usePlayerStore";
import "./SeekBar.css";

interface SeekBarProps {
  className?: string;
  nodeId?: string;
  interactionEnabled?: boolean;
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

function ratioFromClientX(el: HTMLInputElement, clientX: number): number {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
}

export function SeekBar({
  className,
  nodeId,
  interactionEnabled = true,
}: SeekBarProps) {
  const library = usePlayerStore((s) => s.library);
  const playbackTracks = usePlayerStore((s) => s.playbackTracks);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  /** Pointer seeks use clientX ratios only; native range onChange disagrees (thumb centering). */
  const pointerSeekActiveRef = useRef(false);

  const currentTrack = useMemo(
    () => findPlaybackTrack({ library, playbackTracks, currentTrackId }),
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
    pointerSeekActiveRef.current = false;
    handleSeekEnd(ratioFromClientX(e.currentTarget, e.clientX));
  };

  return (
    <div
      className={["seek-bar", className].filter(Boolean).join(" ")}
      data-node-id={nodeId}
      aria-disabled={interactionEnabled ? undefined : true}
      style={interactionEnabled ? undefined : { pointerEvents: "none" }}
    >
      <span className="seek-bar__time">{formatTime(displayPosition)}</span>
      <Slider
        className="seek-bar__slider"
        min={0}
        max={1}
        step={0.001}
        value={isSeeking ? seekValue : progress}
        disabled={disabled}
        aria-label={t("playback:seek.aria")}
        onPointerDown={(e) => {
          if (disabled || e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          pointerSeekActiveRef.current = true;
          handleSeekStart();
          handleSeekChange(ratioFromClientX(e.currentTarget, e.clientX));
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          handleSeekChange(ratioFromClientX(e.currentTarget, e.clientX));
        }}
        onChange={(e) => {
          // Ignore during pointer seeks — native range value uses thumb centering
          // and fights ratioFromClientX (~1–3s flicker on click-to-seek).
          if (pointerSeekActiveRef.current) return;
          handleSeekChange(Number(e.currentTarget.value));
        }}
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

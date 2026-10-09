import {
  useLayoutEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { Slider } from "../../common/Slider/Slider";
import * as audio from "../../../lib/playback";
import { subscribePlaybackClock } from "../../../lib/playbackClock";
import { resolvePlaybackDisplaySeconds } from "../../../lib/playbackClockPin";
import { createPlayheadGlide } from "../../../lib/playheadGlide";
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

/**
 * Fill is a track-wide bar slid in from the left so its right edge sits at the
 * native thumb centre (`4px + ratio * (width - 8px)`). Percentages resolve
 * against the bar's own width, so this stays correct when the track resizes.
 */
function seekFillTransform(ratio: number): string {
  return `translateX(calc(${(ratio - 1) * 100}% + ${4 - 8 * ratio}px))`;
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

  const elapsedRef = useRef<HTMLSpanElement>(null);
  const remainingRef = useRef<HTMLSpanElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const ratioRef = useRef(0);

  const {
    isSeeking,
    seekValue,
    disabled,
    handleSeekStart,
    handleSeekChange,
    handleSeekEnd,
  } = usePlaybackProgress(durationSeconds);

  const scrubSeconds =
    isSeeking && durationSeconds > 0 ? seekValue * durationSeconds : null;
  const shownSeconds =
    scrubSeconds ?? resolvePlaybackDisplaySeconds(audio.getPositionSeconds());

  useLayoutEffect(() => {
    const paintLabels = (seconds: number) => {
      if (elapsedRef.current) {
        elapsedRef.current.textContent = formatTime(seconds);
      }
      if (remainingRef.current) {
        remainingRef.current.textContent = formatRemainingTime(
          seconds,
          durationSeconds,
        );
      }
    };
    const fill = fillRef.current;
    const glide = createPlayheadGlide(
      fill ? [{ el: fill, transform: seekFillTransform }] : [],
      {
        animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      },
    );
    const paintSlider = (seconds: number, playing: boolean) => {
      const ratio =
        durationSeconds > 0
          ? Math.min(1, Math.max(0, seconds / durationSeconds))
          : 0;
      ratioRef.current = ratio;
      const slider = sliderRef.current;
      // Native value stays current for keyboard and assistive tech; the visible
      // playhead is the glide below, which runs without per-frame JS.
      if (slider) slider.value = String(ratio);
      glide.sync(seconds, durationSeconds, playing);
    };

    if (scrubSeconds !== null) {
      paintLabels(scrubSeconds);
      paintSlider(scrubSeconds, false);
      return glide.dispose;
    }

    const applySample = (seconds: number) => {
      paintLabels(seconds);
      if (pointerSeekActiveRef.current) return;
      paintSlider(
        seconds,
        usePlayerStore.getState().playbackState === "playing",
      );
    };

    applySample(resolvePlaybackDisplaySeconds(audio.getPositionSeconds()));
    const unsubscribeClock = subscribePlaybackClock((seconds) => {
      if (pointerSeekActiveRef.current) return;
      applySample(seconds);
    });
    const unsubscribeStore = usePlayerStore.subscribe((state, prev) => {
      if (state.playbackState === prev.playbackState) return;
      if (pointerSeekActiveRef.current) return;
      applySample(resolvePlaybackDisplaySeconds(audio.getPositionSeconds()));
    });

    return () => {
      unsubscribeClock();
      unsubscribeStore();
      glide.dispose();
    };
  }, [durationSeconds, scrubSeconds]);

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
      <span ref={elapsedRef} className="seek-bar__time">
        {formatTime(shownSeconds)}
      </span>
      <div className="seek-bar__track">
        <Slider
          ref={sliderRef}
          className="seek-bar__slider"
          min={0}
          max={1}
          step={0.001}
          value={isSeeking ? seekValue : ratioRef.current}
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
        <div className="seek-bar__rail" aria-hidden>
          <div ref={fillRef} className="seek-bar__fill">
            <span className="seek-bar__thumb" />
          </div>
        </div>
      </div>
      <span
        ref={remainingRef}
        className="seek-bar__time seek-bar__time--remaining"
      >
        {formatRemainingTime(shownSeconds, durationSeconds)}
      </span>
    </div>
  );
}

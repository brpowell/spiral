/**
 * Smooth playhead motion without per-frame JS.
 *
 * The playback clock only ticks about once a second, and anything that writes
 * styles or React state every animation frame keeps the renderer dirty for the
 * whole song (see PR #350). Instead we hand the browser one linear animation of
 * a compositor-only property (`transform`) that runs from the current position
 * to the end of the track. The coarse clock then only checks for drift and
 * restarts the animation when it has been seeked, paused, or fallen behind.
 */

/** Restart the glide once the animation and the clock disagree by this much. */
const DRIFT_RESTART_SECONDS = 0.35;

export interface PlayheadGlideTarget {
  el: HTMLElement;
  /** CSS `transform` value for a playhead ratio in 0..1. Must be animatable. */
  transform: (ratio: number) => string;
}

export interface PlayheadGlide {
  /**
   * Place the playhead at `seconds`. While `playing`, it then glides to the end
   * of the track. Calls that agree with the running glide are no-ops.
   */
  sync(seconds: number, durationSeconds: number, playing: boolean): void;
  /** Stop animating. The playhead stays where the last sync put it. */
  dispose(): void;
}

interface RunningGlide {
  anchorSeconds: number;
  anchorAtMs: number;
  durationSeconds: number;
}

export function playheadRatio(
  seconds: number,
  durationSeconds: number,
): number {
  if (!(durationSeconds > 0)) return 0;
  return Math.min(1, Math.max(0, seconds / durationSeconds));
}

export function createPlayheadGlide(
  targets: readonly PlayheadGlideTarget[],
  options: { animate?: boolean; nowMs?: () => number } = {},
): PlayheadGlide {
  const animate = options.animate ?? true;
  const nowMs = options.nowMs ?? (() => performance.now());
  let animations: Animation[] = [];
  let running: RunningGlide | null = null;

  const cancel = () => {
    for (const animation of animations) animation.cancel();
    animations = [];
    running = null;
  };

  return {
    sync(seconds, durationSeconds, playing) {
      if (
        running &&
        playing &&
        running.durationSeconds === durationSeconds &&
        Math.abs(
          running.anchorSeconds +
            (nowMs() - running.anchorAtMs) / 1000 -
            seconds,
        ) < DRIFT_RESTART_SECONDS
      ) {
        return;
      }

      cancel();
      const ratio = playheadRatio(seconds, durationSeconds);
      for (const target of targets) {
        target.el.style.transform = target.transform(ratio);
      }

      if (
        !animate ||
        !playing ||
        !(durationSeconds > 0) ||
        seconds >= durationSeconds
      ) {
        return;
      }

      const remainingMs = (durationSeconds - seconds) * 1000;
      for (const target of targets) {
        if (typeof target.el.animate !== "function") continue;
        animations.push(
          target.el.animate(
            [
              { transform: target.transform(ratio) },
              { transform: target.transform(1) },
            ],
            { duration: remainingMs, easing: "linear", fill: "forwards" },
          ),
        );
      }
      running = {
        anchorSeconds: seconds,
        anchorAtMs: nowMs(),
        durationSeconds,
      };
    },
    dispose: cancel,
  };
}

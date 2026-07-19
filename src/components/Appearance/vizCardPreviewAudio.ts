import { useEffect, useRef, type RefObject } from "react";
import {
  ANALYSER_FFT_SIZE,
  ANALYSER_FREQUENCY_BIN_COUNT,
} from "../../lib/playback";
import {
  copyVisualizerFrame,
  startVisualizerFramePull,
  subscribeVisualizerFrames,
  type VisualizerFramePayload,
  type VisualizerRemoteFrame,
} from "../../lib/visualizerDataBridge";
import { computeAudioEnergy } from "../visualizer/rendererUtils";
import { usePlayerStore } from "../../store/usePlayerStore";

/** Fixed demo time used for idle card snapshots (~1.2s into a beat). */
export const VIZ_CARD_DEMO_SNAPSHOT_MS = 1200;

const EMPTY_REMOTE_FRAME: VisualizerRemoteFrame = {
  bins: null,
  waveform: null,
};

const DEMO_BPM = 120;
const DEMO_BEAT_SECONDS = 60 / DEMO_BPM;

/** Deterministic pseudo-random in [0, 1) for per-hit velocity variation. */
function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Smooth, organic-looking pseudo-noise (sum of incommensurate sines). */
function shimmer(a: number, b: number): number {
  return (
    (Math.sin(a * 0.53 + b * 3.1) +
      Math.sin(a * 1.7 - b * 5.3) +
      Math.sin(a * 0.19 + b * 11)) /
    3
  );
}

/**
 * Synthetic analyser-shaped frame so Appearance previews animate without a
 * local AnalyserNode (and when playback is paused). Modeled loosely on a
 * four-on-the-floor track: kick on the beat, backbeat snare, eighth-note
 * hi-hats, a slowly drifting melodic formant, and bar-level build/drop
 * dynamics, so it reads as an actual song rather than a clean pulse.
 */
export function generateDemoVisualizerFrame(
  elapsedMs: number,
): VisualizerFramePayload {
  const t = elapsedMs / 1000;

  const beatPos = t / DEMO_BEAT_SECONDS;
  const beatIndex = Math.floor(beatPos);
  const beatPhase = beatPos - beatIndex;
  const beatInBar = beatIndex % 4;
  const barIndex = Math.floor(beatIndex / 4);

  const kickVelocity = 0.85 + 0.3 * hash(beatIndex * 3.1);
  const kickEnv = Math.exp(-beatPhase * 7) * kickVelocity;

  const isBackbeat = beatInBar === 1 || beatInBar === 3;
  const snareEnv = isBackbeat ? Math.exp(-beatPhase * 10) : 0;

  const eighthPos = t / (DEMO_BEAT_SECONDS / 2);
  const eighthIndex = Math.floor(eighthPos);
  const eighthPhase = eighthPos - eighthIndex;
  const isOpenHat = eighthIndex % 2 === 1;
  const hatVelocity = 0.7 + 0.5 * hash(eighthIndex * 7.7);
  const hatEnv =
    Math.exp(-eighthPhase * (isOpenHat ? 14 : 26)) *
    (isOpenHat ? 0.85 : 0.5) *
    hatVelocity;

  // Slow build/drop across a 16-bar phrase, plus a touch of bar-to-bar sway.
  const phraseCycle = Math.sin((barIndex / 16) * Math.PI * 2 - Math.PI / 2);
  const sectionEnergy =
    0.68 + 0.32 * (phraseCycle * 0.5 + 0.5) + 0.05 * hash(barIndex * 1.9);

  // Small mid "formant" bump drifts slowly rather than sitting still.
  const bumpN = 0.36 + 0.06 * Math.sin(t * 0.35) + 0.03 * Math.sin(t * 0.9 + 1.3);

  const binCount = ANALYSER_FREQUENCY_BIN_COUNT;
  const bins = new Array<number>(binCount);

  for (let i = 0; i < binCount; i++) {
    const n = i / Math.max(1, binCount - 1);
    // Real music spectra skew heavily toward bass, falling off smoothly
    // toward treble rather than forming separate isolated peaks.
    const decay = Math.exp(-n * 2.1) * (1 - Math.pow(n, 4));
    const jitter = 0.82 + 0.18 * shimmer(i * 1.4, t * 1.8);
    const bassPulse = 1 + kickEnv * 0.5 * Math.exp(-n * 6);
    const hatShimmer = 1 + hatEnv * 0.45 * n;
    const midBump =
      1 + (0.35 + snareEnv * 0.45) * Math.exp(-Math.pow((n - bumpN) / 0.1, 2));

    const value =
      235 * decay * jitter * bassPulse * hatShimmer * midBump * sectionEnergy +
      shimmer(i, t) * 4;
    bins[i] = Math.max(0, Math.min(255, value));
  }

  const waveLen = ANALYSER_FFT_SIZE;
  const waveform = new Array<number>(waveLen);
  for (let i = 0; i < waveLen; i++) {
    const x = i / waveLen;
    const kickTone = Math.sin(x * Math.PI * 2 * 2.2 + t * 2) * kickEnv * 0.5;
    const bodyTone = Math.sin(x * Math.PI * 2 * 3.1 + t * 3) * 0.1;
    const melodyTone =
      Math.sin(x * Math.PI * 2 * 7 + t * 6.5) * (0.15 + snareEnv * 0.2);
    const hatCrackle = shimmer(x * waveLen * 0.9, t * 40) * hatEnv * 0.25;
    const value =
      (kickTone + bodyTone + melodyTone + hatCrackle) * sectionEnergy;
    waveform[i] = Math.max(-1, Math.min(1, value));
  }

  return {
    bins,
    waveform,
    ...computeAudioEnergy(bins),
  };
}

function writeDemoFrame(
  target: VisualizerRemoteFrame,
  elapsedMs: number,
): void {
  copyVisualizerFrame(target, generateDemoVisualizerFrame(elapsedMs));
}

/**
 * Remote frame feed for the hover live preview: bridged live analyser when
 * playing, otherwise synthetic demo audio. `forcePlaying` is true in demo mode
 * so renderers that gate on isPlaying still animate.
 */
export function useVizCardPreviewFrameRef(): {
  remoteFrameRef: RefObject<VisualizerRemoteFrame>;
  forcePlaying: boolean;
} {
  const playbackState = usePlayerStore((s) => s.playbackState);
  const playing = playbackState === "playing";
  const remoteFrameRef = useRef<VisualizerRemoteFrame>({ ...EMPTY_REMOTE_FRAME });

  useEffect(() => {
    if (playing) {
      const stopPull = startVisualizerFramePull();
      const stopSubscribe = subscribeVisualizerFrames((frame) => {
        copyVisualizerFrame(remoteFrameRef.current, frame);
      });
      return () => {
        stopPull();
        stopSubscribe();
      };
    }

    const start = performance.now();
    let rafId = 0;
    const loop = (now: number) => {
      writeDemoFrame(remoteFrameRef.current, now - start);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [playing]);

  return { remoteFrameRef, forcePlaying: !playing };
}

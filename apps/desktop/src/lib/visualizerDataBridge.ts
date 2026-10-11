import { emit, listen } from "@tauri-apps/api/event";
import { computeAudioEnergy } from "../components/visualizer/rendererUtils";
import {
  ANALYSER_FREQUENCY_BIN_COUNT,
  ANALYSER_FFT_SIZE,
  getAnalyser,
} from "./playback";
import { usePlayerStore } from "../store/usePlayerStore";

export const VISUALIZER_FRAME_EVENT = "visualizer://frame";
export const VISUALIZER_REQUEST_FRAME_EVENT = "visualizer://request-frame";
/** Target rate for skin-mode cross-window frames (~60 fps). */
export const MINI_VISUALIZER_INTERVAL_MS = 16;

let frequencyBuffer: Uint8Array<ArrayBuffer> = new Uint8Array(
  ANALYSER_FREQUENCY_BIN_COUNT,
);
let timeDomainBuffer: Uint8Array<ArrayBuffer> = new Uint8Array(
  ANALYSER_FFT_SIZE,
);

export interface VisualizerRemoteFrame {
  bins: number[] | null;
  waveform: number[] | null;
}

/** Complete analyser snapshot for cross-window visualizers (matches main-window inputs). */
export interface VisualizerFramePayload {
  bins: number[];
  waveform: number[];
  overallEnergy: number;
  bassEnergy: number;
  midEnergy: number;
  trebleEnergy: number;
}

function ensureAnalyserBuffers(
  fftSize: number,
  frequencyBinCount: number,
): void {
  if (timeDomainBuffer.length !== fftSize) {
    timeDomainBuffer = new Uint8Array(fftSize);
  }
  if (frequencyBuffer.length !== frequencyBinCount) {
    frequencyBuffer = new Uint8Array(frequencyBinCount);
  }
}

/** Sample the main-window analyser and emit a frame to other webviews. */
export function sampleAndEmitVisualizerFrame(): boolean {
  const { playbackState } = usePlayerStore.getState();
  if (playbackState !== "playing") return false;

  const analyser = getAnalyser();
  if (!analyser) return false;

  const fftSize = analyser.fftSize;
  const frequencyBinCount = analyser.frequencyBinCount;
  ensureAnalyserBuffers(fftSize, frequencyBinCount);

  analyser.getByteFrequencyData(frequencyBuffer);
  const bins = new Array<number>(frequencyBinCount);
  for (let i = 0; i < frequencyBinCount; i++) {
    bins[i] = frequencyBuffer[i] ?? 0;
  }

  analyser.getByteTimeDomainData(timeDomainBuffer);
  const waveform = new Array<number>(fftSize);
  for (let i = 0; i < fftSize; i++) {
    const value = timeDomainBuffer[i] ?? 128;
    waveform[i] = (value - 128) / 128;
  }

  const energy = computeAudioEnergy(bins);

  void emit(VISUALIZER_FRAME_EVENT, {
    bins,
    waveform,
    ...energy,
  } satisfies VisualizerFramePayload);
  return true;
}

/**
 * Runs in the main window (where the shared playback analyser lives).
 * Responds to pull requests from the skin-mode webview only — no push loop.
 */
export function startVisualizerDataProvider(): () => void {
  let unlistenPull: (() => void) | undefined;
  let cancelled = false;

  void listen(VISUALIZER_REQUEST_FRAME_EVENT, () => {
    sampleAndEmitVisualizerFrame();
  }).then((fn) => {
    if (cancelled) fn();
    else unlistenPull = fn;
  });

  return () => {
    cancelled = true;
    unlistenPull?.();
  };
}

/**
 * Runs in the skin-mode webview. Requests frames from the main window while
 * playback is active so updates keep flowing when the main webview is hidden.
 */
export function startVisualizerFramePull(): () => void {
  const intervalId = setInterval(() => {
    if (usePlayerStore.getState().playbackState === "playing") {
      void emit(VISUALIZER_REQUEST_FRAME_EVENT, {});
    }
  }, MINI_VISUALIZER_INTERVAL_MS);

  return () => clearInterval(intervalId);
}

export function subscribeVisualizerFrames(
  onFrame: (frame: VisualizerFramePayload) => void,
): () => void {
  let unlisten: (() => void) | undefined;
  let cancelled = false;

  void listen<VisualizerFramePayload>(VISUALIZER_FRAME_EVENT, (event) => {
    onFrame(event.payload);
  }).then((fn) => {
    if (cancelled) fn();
    else unlisten = fn;
  });

  return () => {
    cancelled = true;
    unlisten?.();
  };
}

/** Copy incoming frame into existing arrays to avoid per-frame allocations. */
export function copyVisualizerFrame(
  target: VisualizerRemoteFrame,
  source: VisualizerFramePayload,
): VisualizerRemoteFrame {
  const sourceBins = source.bins ?? [];
  if (!target.bins || target.bins.length !== sourceBins.length) {
    target.bins = sourceBins.slice();
  } else {
    for (let i = 0; i < sourceBins.length; i++) {
      target.bins[i] = sourceBins[i] ?? 0;
    }
  }

  const sourceWaveform = source.waveform ?? [];
  if (!target.waveform || target.waveform.length !== sourceWaveform.length) {
    target.waveform = sourceWaveform.slice();
  } else {
    for (let i = 0; i < sourceWaveform.length; i++) {
      target.waveform[i] = sourceWaveform[i] ?? 0;
    }
  }

  return target;
}

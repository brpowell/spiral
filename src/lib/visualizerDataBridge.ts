import { emit, listen } from "@tauri-apps/api/event";
import { getAnalyser } from "./playback";
import { usePlayerStore } from "../store/usePlayerStore";

export const VISUALIZER_FRAME_EVENT = "visualizer://frame";
export const VISUALIZER_REQUEST_FRAME_EVENT = "visualizer://request-frame";
export const VISUALIZER_BAR_COUNT = 64;
/** Target rate for skin-mode cross-window frames (~60 fps). */
export const MINI_VISUALIZER_INTERVAL_MS = 16;

const analyserBuffer = new Uint8Array(VISUALIZER_BAR_COUNT * 2);
const emitBins: number[] = new Array(VISUALIZER_BAR_COUNT);

export interface VisualizerFramePayload {
  bins: number[];
}

/** Sample the main-window analyser and emit a frame to other webviews. */
export function sampleAndEmitVisualizerFrame(): boolean {
  const { playbackState } = usePlayerStore.getState();
  if (playbackState !== "playing") return false;

  const analyser = getAnalyser();
  if (!analyser) return false;

  analyser.getByteFrequencyData(analyserBuffer);
  for (let i = 0; i < VISUALIZER_BAR_COUNT; i++) {
    const dataIndex = Math.floor(
      (i / VISUALIZER_BAR_COUNT) * analyserBuffer.length,
    );
    emitBins[i] = analyserBuffer[dataIndex] ?? 0;
  }
  void emit(VISUALIZER_FRAME_EVENT, {
    bins: emitBins.slice(),
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
  onFrame: (bins: number[]) => void,
): () => void {
  let unlisten: (() => void) | undefined;
  let cancelled = false;

  void listen<VisualizerFramePayload>(VISUALIZER_FRAME_EVENT, (event) => {
    onFrame(event.payload.bins);
  }).then((fn) => {
    if (cancelled) fn();
    else unlisten = fn;
  });

  return () => {
    cancelled = true;
    unlisten?.();
  };
}

/** Copy incoming bins into an existing array to avoid per-frame allocations on the mini side. */
export function copyVisualizerBins(
  target: number[],
  source: number[],
): number[] {
  if (target.length !== source.length) {
    return source.slice();
  }
  for (let i = 0; i < source.length; i++) {
    target[i] = source[i] ?? 0;
  }
  return target;
}

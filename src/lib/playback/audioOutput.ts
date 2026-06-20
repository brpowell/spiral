import type { EqualizerState } from "../equalizer/types";
import {
  applyEqualizerState as applyEqChainState,
  disposeEqualizerChain,
  ensureEqualizerChain,
} from "./eqAudio";

const FFT_SIZE = 256;
const SMOOTHING = 0.8;

/** Shared with visualizer bridge — must match `AnalyserNode.fftSize`. */
export const ANALYSER_FFT_SIZE = FFT_SIZE;
export const ANALYSER_FREQUENCY_BIN_COUNT = FFT_SIZE / 2;

let analyser: AnalyserNode | null = null;
let wiredSource: AudioNode | null = null;

/** Insert `source` → EQ → analyser → destination on the shared bus. */
export function connectEngineOutput(source: AudioNode): AnalyserNode {
  const ctx = source.context;

  if (analyser && analyser.context !== ctx) {
    analyser = null;
    wiredSource = null;
    disposeEqualizerChain();
  }

  if (!analyser) {
    analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = SMOOTHING;
  }

  const eq = ensureEqualizerChain(ctx);

  if (wiredSource !== source) {
    if (wiredSource) {
      try {
        wiredSource.disconnect();
      } catch {
        // already disconnected
      }
    }

    try {
      source.disconnect();
    } catch {
      // e.g. Howler may have connected source → destination
    }

    source.connect(eq.input);
    eq.output.connect(analyser);
    analyser.connect(ctx.destination);
    wiredSource = source;
  }

  return analyser;
}

export function getAnalyser(): AnalyserNode | null {
  return analyser;
}

export function disconnectEngineOutput(): void {
  if (wiredSource) {
    try {
      wiredSource.disconnect();
    } catch {
      // already disconnected
    }
    wiredSource = null;
  }
  analyser = null;
  disposeEqualizerChain();
}

export function applyEqualizerState(
  state: Pick<EqualizerState, "enabled" | "bands" | "preampGain">,
): void {
  applyEqChainState(state);
}

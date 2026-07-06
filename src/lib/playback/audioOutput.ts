import { connectDeckOutput, disconnectDeckOutput } from "./audioMixer";

export {
  ANALYSER_FFT_SIZE,
  ANALYSER_FREQUENCY_BIN_COUNT,
  applyEqualizerState,
  connectDeckOutput,
  disconnectAllDeckOutputs,
  disconnectDeckOutput,
  getAnalyser,
  getDeckGainNode,
  rampDeckGain,
  setDeckGain,
  type DeckId,
} from "./audioMixer";

/** Insert `source` → deck A → EQ → analyser → destination on the shared bus. */
export function connectEngineOutput(source: AudioNode): AnalyserNode {
  return connectDeckOutput("a", source);
}

export function disconnectEngineOutput(): void {
  disconnectDeckOutput("a");
}

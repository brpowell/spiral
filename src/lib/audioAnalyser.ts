import { Howler } from "howler";

const FFT_SIZE = 256;
const SMOOTHING = 0.8;

let analyser: AnalyserNode | null = null;
let wired = false;

export function ensureAnalyser(): AnalyserNode | null {
  const ctx = Howler.ctx;
  const masterGain = Howler.masterGain;

  if (!ctx || !masterGain) {
    return null;
  }

  if (wired && analyser && analyser.context !== ctx) {
    analyser = null;
    wired = false;
  }

  if (!wired) {
    analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = SMOOTHING;

    masterGain.disconnect();
    masterGain.connect(analyser);
    analyser.connect(ctx.destination);
    wired = true;
  }

  return analyser;
}

export function getAnalyser(): AnalyserNode | null {
  return analyser;
}

import { Channel, invoke } from "@tauri-apps/api/core";
import { getWindowRole } from "../windowRole";
import type { AudioAnalyser } from "./audioMixer";

/** Must match `FFT_SIZE` / `BIN_COUNT` in `native_audio/analyser.rs`. */
export const NATIVE_ANALYSER_FFT_SIZE = 256;
export const NATIVE_ANALYSER_BIN_COUNT = NATIVE_ANALYSER_FFT_SIZE / 2;
const FRAME_BYTES = NATIVE_ANALYSER_BIN_COUNT + NATIVE_ANALYSER_FFT_SIZE;

const frequency = new Uint8Array(NATIVE_ANALYSER_BIN_COUNT);
const timeDomain = new Uint8Array(NATIVE_ANALYSER_FFT_SIZE).fill(128);
let subscribed = false;

/**
 * Same surface as the `AnalyserNode` the visualizers read, backed by the latest
 * frame Rust computed from the mixer output. Bytes arrive already in
 * `getByteFrequencyData` / `getByteTimeDomainData` form, so reads are copies.
 */
const nativeAnalyser: AudioAnalyser = {
  fftSize: NATIVE_ANALYSER_FFT_SIZE,
  frequencyBinCount: NATIVE_ANALYSER_BIN_COUNT,
  getByteFrequencyData(target) {
    target.set(frequency.subarray(0, target.length));
  },
  getByteTimeDomainData(target) {
    target.set(timeDomain.subarray(0, target.length));
  },
};

/**
 * Start receiving frames. Only the main window subscribes: Rust keeps a single
 * subscriber, and the other windows get frames from the main window's bridge.
 */
export function ensureNativeAnalyser(): void {
  if (subscribed || getWindowRole() !== "main") return;
  subscribed = true;
  const frames = new Channel<ArrayBuffer>((buffer) => {
    if (buffer.byteLength !== FRAME_BYTES) return;
    const bytes = new Uint8Array(buffer);
    frequency.set(bytes.subarray(0, NATIVE_ANALYSER_BIN_COUNT));
    timeDomain.set(bytes.subarray(NATIVE_ANALYSER_BIN_COUNT));
  });
  void invoke("start_native_analyser", { frames }).catch((err) => {
    subscribed = false;
    console.error("Native analyser start failed:", err);
  });
}

export function stopNativeAnalyser(): void {
  if (!subscribed) return;
  subscribed = false;
  frequency.fill(0);
  timeDomain.fill(128);
  void invoke("stop_native_analyser").catch(() => {});
}

export function getNativeAnalyser(): AudioAnalyser {
  return nativeAnalyser;
}

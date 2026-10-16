import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, channels, role } = vi.hoisted(() => ({
  invoke: vi.fn(),
  channels: [] as Array<{ onmessage: (data: ArrayBuffer) => void }>,
  role: { value: "main" },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  Channel: class {
    onmessage: (data: ArrayBuffer) => void;
    constructor(handler: (data: ArrayBuffer) => void) {
      this.onmessage = handler;
      channels.push(this);
    }
  },
}));
vi.mock("../windowRole", () => ({ getWindowRole: () => role.value }));

import {
  ensureNativeAnalyser,
  getNativeAnalyser,
  NATIVE_ANALYSER_BIN_COUNT,
  NATIVE_ANALYSER_FFT_SIZE,
  stopNativeAnalyser,
} from "./nativeAnalyser";

function frame(freqByte: number, waveByte: number): ArrayBuffer {
  const bytes = new Uint8Array(
    NATIVE_ANALYSER_BIN_COUNT + NATIVE_ANALYSER_FFT_SIZE,
  );
  bytes.fill(freqByte, 0, NATIVE_ANALYSER_BIN_COUNT);
  bytes.fill(waveByte, NATIVE_ANALYSER_BIN_COUNT);
  return bytes.buffer;
}

describe("native analyser", () => {
  beforeEach(() => {
    stopNativeAnalyser();
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    channels.length = 0;
    role.value = "main";
  });

  it("matches the AnalyserNode shape the visualizers expect", () => {
    const analyser = getNativeAnalyser();
    expect(analyser.fftSize).toBe(256);
    expect(analyser.frequencyBinCount).toBe(128);
  });

  it("subscribes once and reads frames into the caller's arrays", () => {
    ensureNativeAnalyser();
    ensureNativeAnalyser();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]![0]).toBe("start_native_analyser");

    channels[0]!.onmessage(frame(200, 64));

    const analyser = getNativeAnalyser();
    const freq = new Uint8Array(analyser.frequencyBinCount);
    const wave = new Uint8Array(analyser.fftSize);
    analyser.getByteFrequencyData(freq);
    analyser.getByteTimeDomainData(wave);
    expect(freq.every((b) => b === 200)).toBe(true);
    expect(wave.every((b) => b === 64)).toBe(true);
  });

  it("ignores malformed frames", () => {
    ensureNativeAnalyser();
    channels[0]!.onmessage(frame(10, 10));
    channels[0]!.onmessage(new ArrayBuffer(7));

    const freq = new Uint8Array(128);
    getNativeAnalyser().getByteFrequencyData(freq);
    expect(freq[0]).toBe(10);
  });

  it("fills a shorter destination without overflow", () => {
    ensureNativeAnalyser();
    channels[0]!.onmessage(frame(99, 99));
    const small = new Uint8Array(16);
    getNativeAnalyser().getByteFrequencyData(small);
    expect(small.every((b) => b === 99)).toBe(true);
  });

  it("only the main window subscribes", () => {
    role.value = "skin-mode";
    ensureNativeAnalyser();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("resets to silence when stopped and can resubscribe", () => {
    ensureNativeAnalyser();
    channels[0]!.onmessage(frame(200, 64));
    stopNativeAnalyser();
    expect(invoke).toHaveBeenLastCalledWith("stop_native_analyser");

    const freq = new Uint8Array(128);
    const wave = new Uint8Array(256);
    getNativeAnalyser().getByteFrequencyData(freq);
    getNativeAnalyser().getByteTimeDomainData(wave);
    expect(freq.every((b) => b === 0)).toBe(true);
    expect(wave.every((b) => b === 128)).toBe(true);

    ensureNativeAnalyser();
    expect(channels).toHaveLength(2);
  });

  it("allows a retry after the start command fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    invoke.mockRejectedValueOnce(new Error("no output"));
    ensureNativeAnalyser();
    await Promise.resolve();
    await Promise.resolve();
    ensureNativeAnalyser();
    expect(channels).toHaveLength(2);
    error.mockRestore();
  });
});

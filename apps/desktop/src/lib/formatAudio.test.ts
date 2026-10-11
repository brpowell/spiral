import { describe, expect, it } from "vitest";
import {
  formatBitrate,
  formatCodec,
  formatSampleRate,
} from "./formatAudio";

describe("formatCodec", () => {
  it("normalizes known codecs", () => {
    expect(formatCodec("flac")).toBe("FLAC");
    expect(formatCodec("alac")).toBe("ALAC");
    expect(formatCodec("mp3")).toBe("MP3");
  });
});

describe("formatSampleRate", () => {
  it("formats common rates in kHz", () => {
    expect(formatSampleRate(44_100)).toBe("44.1 kHz");
    expect(formatSampleRate(48_000)).toBe("48 kHz");
  });
});

describe("formatBitrate", () => {
  it("formats kbps and Mbps", () => {
    expect(formatBitrate(320_000)).toBe("320 kbps");
    expect(formatBitrate(1_411_200)).toBe("1.4 Mbps");
  });
});

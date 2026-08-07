import { describe, expect, it } from "vitest";
import {
  audioExtensionFromPath,
  isSupportedAudioPath,
  SUPPORTED_AUDIO_EXTENSIONS,
} from "./supportedAudio";

describe("supportedAudio", () => {
  it("accepts ogg and opus paths", () => {
    expect(isSupportedAudioPath("/music/track.ogg")).toBe(true);
    expect(isSupportedAudioPath("/music/track.opus")).toBe(true);
  });

  it("accepts every library allowlist format", () => {
    for (const ext of SUPPORTED_AUDIO_EXTENSIONS) {
      expect(isSupportedAudioPath(`/music/a.${ext}`)).toBe(true);
    }
    expect(isSupportedAudioPath("/music/a.m4p")).toBe(false);
    expect(isSupportedAudioPath("/music/readme.txt")).toBe(false);
  });

  it("parses extensions case-insensitively", () => {
    expect(audioExtensionFromPath("/music/A.OGG")).toBe("ogg");
    expect(audioExtensionFromPath("Track.OPUS")).toBe("opus");
  });
});

import { describe, expect, it } from "vitest";
import {
  audioExtensionFromPath,
  isSupportedAudioPath,
  requiresPcmPlayback,
} from "./supportedAudio";

describe("supportedAudio ogg/opus", () => {
  it("accepts ogg and opus paths", () => {
    expect(isSupportedAudioPath("/music/track.ogg")).toBe(true);
    expect(isSupportedAudioPath("/music/track.opus")).toBe(true);
  });

  it("requires PCM playback for ogg and opus only", () => {
    expect(requiresPcmPlayback("/music/a.ogg")).toBe(true);
    expect(requiresPcmPlayback("/music/a.opus")).toBe(true);
    expect(requiresPcmPlayback("/music/a.flac")).toBe(false);
    expect(requiresPcmPlayback("/music/a.mp3")).toBe(false);
  });

  it("parses extensions case-insensitively", () => {
    expect(audioExtensionFromPath("/music/A.OGG")).toBe("ogg");
    expect(audioExtensionFromPath("Track.OPUS")).toBe("opus");
  });
});

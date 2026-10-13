import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "../../../types/track";

const env = vi.hoisted(() => ({ skinWindow: false, audioSeconds: 0 }));

vi.mock("../../../lib/windowRole", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../lib/windowRole")>();
  return { ...actual, isAnySkinWindow: () => env.skinWindow };
});

vi.mock("../../../lib/playback", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/playback")>();
  return {
    ...actual,
    getPositionSeconds: () => env.audioSeconds,
    getDurationSeconds: () => 0,
  };
});

import { resetPlaybackClock } from "../../../lib/playbackClock";
import { resetPlaybackClockPin } from "../../../lib/playbackClockPin";
import { usePlayerStore } from "../../../store/usePlayerStore";
import { SeekBar } from "./SeekBar";

function track(): Track {
  return {
    id: 1,
    title: "Airbag",
    artist: "Radiohead",
    album: "OK Computer",
    albumArtist: "Radiohead",
    trackNumber: 1,
    totalTracks: null,
    discNumber: 1,
    totalDiscs: null,
    year: 1997,
    genre: null,
    durationSeconds: 240,
    sampleRate: null,
    bitrate: null,
    codec: null,
    filePath: "/library/airbag.mp3",
    artPath: null,
    dateAdded: "2024-01-01",
    playCount: 0,
    lastPlayedAt: null,
    rating: 0,
  };
}

function elapsedLabel(container: HTMLElement): string {
  return container.querySelector(".seek-bar__time")?.textContent ?? "";
}

function slider(container: HTMLElement): HTMLInputElement {
  return container.querySelector<HTMLInputElement>(".seek-bar__slider")!;
}

describe("SeekBar in a skin window", () => {
  beforeEach(() => {
    env.skinWindow = true;
    // A skin window runs no audio engine, so its local clock never leaves 0.
    env.audioSeconds = 0;
    usePlayerStore.setState({
      library: [track()],
      playbackTracks: [],
      currentTrackId: 1,
      playbackState: "paused",
      positionSeconds: 60,
      seekPreviewRatio: null,
    });
  });

  afterEach(() => {
    resetPlaybackClock();
    resetPlaybackClockPin();
    usePlayerStore.setState({
      library: [],
      currentTrackId: null,
      playbackState: "stopped",
      positionSeconds: 0,
      seekPreviewRatio: null,
    });
  });

  it("shows the synced position instead of the idle local audio clock", () => {
    const { container } = render(<SeekBar />);

    expect(elapsedLabel(container)).toBe("1:00");
    expect(Number(slider(container).value)).toBeCloseTo(0.25, 3);
  });

  it("follows store position updates while playing", () => {
    usePlayerStore.setState({ playbackState: "playing" });
    const { container } = render(<SeekBar />);

    act(() => {
      usePlayerStore.setState({ positionSeconds: 120 });
    });

    expect(elapsedLabel(container)).toBe("2:00");
    expect(Number(slider(container).value)).toBeCloseTo(0.5, 3);
  });

  it("lands on the seek target once the scrub preview clears", () => {
    const { container } = render(<SeekBar />);

    act(() => {
      usePlayerStore.setState({ seekPreviewRatio: 0.75, positionSeconds: 180 });
    });
    expect(elapsedLabel(container)).toBe("3:00");

    act(() => {
      usePlayerStore.setState({ seekPreviewRatio: null });
    });

    // Previously this fell back to the idle audio clock and jumped to 0:00.
    expect(elapsedLabel(container)).toBe("3:00");
    expect(Number(slider(container).value)).toBeCloseTo(0.75, 3);
  });
});

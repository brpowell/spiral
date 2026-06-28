import { describe, expect, it } from "vitest";
import type { SkinBindState } from "./skinBinds";
import { resolveSkinTooltip } from "./skinTooltips";

function minimalBindState(overrides: Partial<SkinBindState> = {}): SkinBindState {
  return {
    currentTrack: null,
    artUrl: null,
    playbackState: "stopped",
    positionSeconds: 83,
    repeatMode: "off",
    shuffle: false,
    volume: 0.72,
    balance: 0,
    muted: false,
    canGoPrevious: false,
    canGoNext: false,
    activeQueueLength: 0,
    currentTrackId: null,
    alwaysOnTop: false,
    currentPlayable: null,
    panelOpen: {},
    panelRevealed: {},
    panelSettled: {},
    visualizerName: "Bars",
    canCycleVisualizer: false,
    playlistSourceId: "all",
    playlists: [],
    library: [],
    playbackTracks: [],
    eqEnabled: true,
    eqPresetId: "manual",
    eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    eqCustomPresets: [],
    soundEffectsEnabled: true,
    viewState: {},
    slideshowPresentations: {},
    slideshowState: {},
    ...overrides,
  };
}

describe("resolveSkinTooltip", () => {
  it("prefers tooltipWhen over tooltip and defaults", () => {
    const state = minimalBindState({ muted: true });
    expect(
      resolveSkinTooltip(
        {
          action: "player.toggleMute",
          tooltip: "Mute",
          tooltipWhen: { "player.muted": "Unmute" },
        },
        state,
      ),
    ).toBe("Unmute");
  });

  it("interpolates bind placeholders in tooltip templates", () => {
    const state = minimalBindState({
      currentTrack: {
        id: 1,
        title: "Track",
        artist: "Artist",
        album: "Album",
        durationSeconds: 296,
        filePath: "/a.mp3",
        dateAdded: "",
      },
    });
    expect(
      resolveSkinTooltip(
        { tooltip: "{player.positionLabel} / {player.durationLabel}" },
        state,
      ),
    ).toBe("1:23 / 4:56");
  });

  it("derives mute/play defaults from bind state", () => {
    expect(
      resolveSkinTooltip({ action: "player.toggleMute" }, minimalBindState()),
    ).toBe("Mute");
    expect(
      resolveSkinTooltip(
        { action: "player.toggleMute" },
        minimalBindState({ muted: true }),
      ),
    ).toBe("Unmute");
    expect(
      resolveSkinTooltip(
        { action: "player.togglePlayPause" },
        minimalBindState({ playbackState: "playing" }),
      ),
    ).toBe("Pause");
  });

  it("formats slider tooltips from live ratio", () => {
    expect(
      resolveSkinTooltip({}, minimalBindState(), {
        sliderMode: "volume",
        ratio: 0.72,
      }),
    ).toBe("Volume: 72%");
    expect(
      resolveSkinTooltip({}, minimalBindState(), {
        sliderMode: "balance",
        ratio: 0.7,
      }),
    ).toBe("Balance: R40");
  });
});

import { describe, expect, it } from "vitest";
import { resolveSkinTooltip } from "./skinTooltips";
import { minimalBindState } from "../test/skinBindFixtures";

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
      positionSeconds: 83,
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

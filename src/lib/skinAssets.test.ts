import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (filePath: string) => `asset://${filePath}`,
}));

import {
  collectBitmapAssetFiles,
  interactiveAssetsUseGif,
  isSkinGifAsset,
  isSkinGifUrl,
  resolveInteractiveAssetFile,
  resolveInteractiveAssets,
  skinAssetFileUrl,
} from "./skinAssets";
import type { SkinBindState } from "./skinBinds";

const baseAssets = {
  default: "buttons/play.png",
  hover: "buttons/play-hover.gif",
  pressed: "buttons/play-pressed.png",
};

const bindState = {
  currentTrack: null,
  artUrl: null,
  playbackState: "playing",
  positionSeconds: 0,
  repeatMode: "off",
  shuffle: false,
  volume: 1,
  balance: 0,
  muted: false,
  canGoPrevious: true,
  canGoNext: true,
  activeQueueLength: 1,
  currentTrackId: 1,
  alwaysOnTop: false,
  currentPlayable: null,
  panelOpen: {},
  panelRevealed: {},
  panelSettled: {},
  visualizerName: "Bars",
  canCycleVisualizer: true,
  playlistSourceId: "all",
  playlists: [],
  library: [],
  playbackTracks: [],
  eqEnabled: false,
  eqPresetId: "flat",
  eqBands: {},
  eqCustomPresets: [],
  soundEffectsEnabled: true,
  viewState: {},
  slideshowPresentations: {},
  slideshowState: {},
  scrollStripPresentations: {},
  scrollStripState: {},
} as SkinBindState;

describe("skinAssetFileUrl", () => {
  it("joins pack dir, assets folder, and relative file path", () => {
    expect(skinAssetFileUrl("/packs/t3", "buttons/play.png")).toBe(
      "asset:///packs/t3/assets/buttons/play.png",
    );
  });
});

describe("resolveInteractiveAssets", () => {
  it("returns base assets when no assetsWhen matches", () => {
    expect(
      resolveInteractiveAssets(baseAssets, undefined, bindState),
    ).toEqual(baseAssets);
  });

  it("uses last matching assetsWhen entry", () => {
    const assetsWhen = {
      "player.isPlaying": {
        default: "buttons/pause.png",
        hover: "buttons/pause-hover.gif",
        pressed: "buttons/pause-pressed.png",
      },
    };
    expect(
      resolveInteractiveAssets(baseAssets, assetsWhen, bindState),
    ).toEqual(assetsWhen["player.isPlaying"]);
  });

  it("falls back to default for missing hover/pressed", () => {
    expect(
      resolveInteractiveAssetFile(
        { default: "buttons/stop.png" },
        undefined,
        bindState,
        "hover",
      ),
    ).toBe("buttons/stop.png");
  });
});

describe("collectBitmapAssetFiles", () => {
  it("collects all declared state files", () => {
    const files = collectBitmapAssetFiles(baseAssets, {
      "player.muted": {
        default: "buttons/mute-muted.png",
        hover: "buttons/mute-muted-hover.png",
      },
    });
    expect(files).toEqual(
      expect.arrayContaining([
        "buttons/play.png",
        "buttons/play-hover.gif",
        "buttons/play-pressed.png",
        "buttons/mute-muted.png",
        "buttons/mute-muted-hover.png",
      ]),
    );
  });
});

describe("isSkinGifAsset", () => {
  it("detects gif extension case-insensitively", () => {
    expect(isSkinGifAsset("buttons/play-hover.gif")).toBe(true);
    expect(isSkinGifAsset("buttons/play-hover.GIF")).toBe(true);
    expect(isSkinGifAsset("buttons/play.png")).toBe(false);
  });
});

describe("isSkinGifUrl", () => {
  it("detects gif extension in asset URLs", () => {
    expect(isSkinGifUrl("asset://localhost/animations/shutter-close.gif")).toBe(
      true,
    );
    expect(
      isSkinGifUrl("asset://localhost/animations/shutter-close.gif?v=1"),
    ).toBe(true);
    expect(isSkinGifUrl("asset://localhost/content/c_xbox.png")).toBe(false);
  });
});

describe("interactiveAssetsUseGif", () => {
  it("returns true when any resolved state is a gif", () => {
    expect(
      interactiveAssetsUseGif(baseAssets, undefined, bindState),
    ).toBe(true);
    expect(
      interactiveAssetsUseGif(
        { default: "buttons/stop.png", pressed: "buttons/stop-pressed.png" },
        undefined,
        bindState,
      ),
    ).toBe(false);
  });
});

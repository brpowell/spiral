import { beforeEach, describe, expect, it, vi } from "vitest";
import { FLAT_BAND_GAINS } from "./equalizer/types";
import { applyEqBandSliderGain } from "./eqBandInput";
import { useEqualizerStore } from "../store/useEqualizerStore";
import type { LoadedSkinPack, SliderEqNode } from "../types/skin";

vi.mock("./windowRole", () => ({
  getWindowRole: vi.fn(() => "main"),
}));

vi.mock("./playback/nativeEqualizer", () => ({
  applyEqualizerState: vi.fn(),
}));

vi.mock("./tauri", () => ({
  saveEqualizerSettings: vi.fn(() => Promise.resolve()),
  saveEqualizerCustomPreset: vi.fn(() => Promise.resolve()),
  deleteEqualizerCustomPreset: vi.fn(() => Promise.resolve()),
}));

const sliderPresentation = {
  kind: "bitmapHorizontalSlider" as const,
  thumb: { default: "sliders/eq.png" },
  trackWidth: 120,
  trackHeight: 20,
  thumbWidth: 20,
  thumbHeight: 19,
};

function makePack(children: SliderEqNode[]): LoadedSkinPack {
  return {
    summary: {
      id: "test",
      name: "Test",
      author: "Test",
      description: "",
      isBuiltin: true,
      packId: "test",
      packName: "Test",
      packVersion: "1.0.0",
      zone: "builtin",
      previewPath: null,
    },
    packDir: "/tmp/test",
    manifest: {
      id: "test",
      name: "Test",
      author: "Test",
      description: "",
      views: {
        main: {
          layout: {
            type: "canvas",
            width: 200,
            height: 80,
            children,
          },
        },
      },
    },
  };
}

describe("eqBand linear spread", () => {
  beforeEach(() => {
    useEqualizerStore.setState({
      enabled: true,
      presetId: "flat",
      lastPresetId: "flat",
      bands: FLAT_BAND_GAINS,
      preampGain: 0,
      customPresets: [],
    });
  });

  it("interpolates the 10-band curve when dragging a spread slider", () => {
    const bass: SliderEqNode = {
      type: "slider",
      control: "eq",
      band: 1,
      spread: "linear",
      presentation: sliderPresentation,
    };
    const treble: SliderEqNode = {
      type: "slider",
      control: "eq",
      band: 10,
      spread: "linear",
      presentation: sliderPresentation,
    };
    const pack = makePack([bass, treble]);

    applyEqBandSliderGain(bass, pack, 9);
    applyEqBandSliderGain(treble, pack, -9);

    const bands = useEqualizerStore.getState().bands;
    expect(useEqualizerStore.getState().presetId).toBe("manual");
    expect(bands[0]).toBe(9);
    expect(bands[9]).toBe(-9);
    expect(bands[4]).toBeCloseTo((5 * 9 + 4 * -9) / 9, 5);
  });

  it("ignores eq sliders that omit spread when interpolating", () => {
    const bass: SliderEqNode = {
      type: "slider",
      control: "eq",
      band: 1,
      spread: "linear",
      presentation: sliderPresentation,
    };
    const mid: SliderEqNode = {
      type: "slider",
      control: "eq",
      band: 5,
      presentation: sliderPresentation,
    };
    const treble: SliderEqNode = {
      type: "slider",
      control: "eq",
      band: 10,
      spread: "linear",
      presentation: sliderPresentation,
    };
    useEqualizerStore.getState().setBand(4, 12);
    applyEqBandSliderGain(bass, makePack([bass, mid, treble]), 9);
    const bands = useEqualizerStore.getState().bands;
    expect(bands[0]).toBe(9);
    expect(bands[4]).toBeCloseTo(5, 5);
    expect(bands[9]).toBe(0);
  });

  it("writes a single band when spread is omitted or unpaired", () => {
    const lone: SliderEqNode = {
      type: "slider",
      control: "eq",
      band: 1,
      presentation: sliderPresentation,
    };
    applyEqBandSliderGain(lone, makePack([lone]), 6);
    expect([...useEqualizerStore.getState().bands]).toEqual([
      6, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);

    const spreadLone: SliderEqNode = {
      type: "slider",
      control: "eq",
      band: 1,
      spread: "linear",
      presentation: sliderPresentation,
    };
    useEqualizerStore.setState({ bands: FLAT_BAND_GAINS });
    applyEqBandSliderGain(spreadLone, makePack([spreadLone]), 6);
    expect([...useEqualizerStore.getState().bands]).toEqual([
      6, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });
});

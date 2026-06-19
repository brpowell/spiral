import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBuiltinPreset } from "../lib/equalizer/builtinPresets";
import { FLAT_BAND_GAINS } from "../lib/equalizer/types";
import { useEqualizerStore } from "./useEqualizerStore";

vi.mock("../lib/windowRole", () => ({
  getWindowRole: vi.fn(() => "main"),
}));

vi.mock("../lib/playback/audioOutput", () => ({
  applyEqualizerState: vi.fn(),
}));

vi.mock("../lib/tauri", () => ({
  getEqualizerSettings: vi.fn(),
  saveEqualizerSettings: vi.fn(() => Promise.resolve()),
}));

describe("useEqualizerStore", () => {
  beforeEach(() => {
    useEqualizerStore.setState({
      enabled: true,
      presetId: "flat",
      bands: FLAT_BAND_GAINS,
      customPresets: [],
    });
  });

  it("setBand forces presetId to manual", () => {
    useEqualizerStore.getState().applyPreset("rock");
    useEqualizerStore.getState().setBand(4, 8);

    const state = useEqualizerStore.getState();
    expect(state.presetId).toBe("manual");
    expect(state.bands[4]).toBe(8);
  });

  it("applyPreset copies builtin bands and sets presetId", () => {
    const rock = getBuiltinPreset("rock");
    expect(rock).toBeDefined();

    useEqualizerStore.getState().applyPreset("rock");

    const state = useEqualizerStore.getState();
    expect(state.presetId).toBe("rock");
    expect([...state.bands]).toEqual([...rock!.bands]);
  });

  it("reset zeroes all bands and sets manual", () => {
    useEqualizerStore.getState().applyPreset("bass");
    useEqualizerStore.getState().reset();

    const state = useEqualizerStore.getState();
    expect(state.presetId).toBe("manual");
    expect([...state.bands]).toEqual([...FLAT_BAND_GAINS]);
  });

  it("setEnabled preserves band values", () => {
    useEqualizerStore.getState().applyPreset("treble");
    const bandsBefore = [...useEqualizerStore.getState().bands];

    useEqualizerStore.getState().setEnabled(false);

    const state = useEqualizerStore.getState();
    expect(state.enabled).toBe(false);
    expect([...state.bands]).toEqual(bandsBefore);
  });

  it("applySnapshot updates state without forcing manual", () => {
    useEqualizerStore.getState().applySnapshot({
      enabled: false,
      presetId: "jazz",
      bands: getBuiltinPreset("jazz")!.bands,
    });

    const state = useEqualizerStore.getState();
    expect(state.enabled).toBe(false);
    expect(state.presetId).toBe("jazz");
    expect([...state.bands]).toEqual([...getBuiltinPreset("jazz")!.bands]);
  });
});

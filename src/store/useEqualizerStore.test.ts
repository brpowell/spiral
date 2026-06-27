import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBuiltinPreset } from "../lib/equalizer/builtinPresets";
import { FLAT_BAND_GAINS, type EqualizerPreset } from "../lib/equalizer/types";
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
  listEqualizerCustomPresets: vi.fn(() => Promise.resolve([])),
  saveEqualizerCustomPreset: vi.fn(() => Promise.resolve()),
  deleteEqualizerCustomPreset: vi.fn(() => Promise.resolve()),
}));

const customPreset: EqualizerPreset = {
  id: "custom-1",
  name: "My Curve",
  bands: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  builtin: false,
};

describe("useEqualizerStore", () => {
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

  it("applyPreset copies custom preset bands", () => {
    useEqualizerStore.setState({ customPresets: [customPreset] });
    useEqualizerStore.getState().applyPreset("custom-1");

    const state = useEqualizerStore.getState();
    expect(state.presetId).toBe("custom-1");
    expect([...state.bands]).toEqual([...customPreset.bands]);
  });

  it("setBand after custom preset switches to manual", () => {
    useEqualizerStore.setState({
      customPresets: [customPreset],
      presetId: "custom-1",
      bands: customPreset.bands,
    });

    useEqualizerStore.getState().setBand(0, -3);

    const state = useEqualizerStore.getState();
    expect(state.presetId).toBe("manual");
    expect(state.bands[0]).toBe(-3);
  });

  it("reset restores active preset bands and keeps preamp", () => {
    const bass = getBuiltinPreset("bass");
    expect(bass).toBeDefined();

    useEqualizerStore.getState().applyPreset("bass");
    useEqualizerStore.getState().setPreampGain(8);
    useEqualizerStore.getState().reset();

    const state = useEqualizerStore.getState();
    expect(state.presetId).toBe("bass");
    expect([...state.bands]).toEqual([...bass!.bands]);
    expect(state.preampGain).toBe(8);
  });

  it("reset after manual band edits restores last preset", () => {
    const rock = getBuiltinPreset("rock");
    expect(rock).toBeDefined();

    useEqualizerStore.getState().applyPreset("rock");
    useEqualizerStore.getState().setBand(4, 8);
    useEqualizerStore.getState().reset();

    const state = useEqualizerStore.getState();
    expect(state.presetId).toBe("rock");
    expect([...state.bands]).toEqual([...rock!.bands]);
  });

  it("setPreampGain updates gain without forcing manual preset", () => {
    useEqualizerStore.getState().applyPreset("rock");
    useEqualizerStore.getState().setPreampGain(6);

    const state = useEqualizerStore.getState();
    expect(state.presetId).toBe("rock");
    expect(state.preampGain).toBe(6);
  });

  it("applyPreset leaves preamp unchanged", () => {
    useEqualizerStore.getState().setPreampGain(5);
    useEqualizerStore.getState().applyPreset("jazz");

    const state = useEqualizerStore.getState();
    expect(state.presetId).toBe("jazz");
    expect(state.preampGain).toBe(5);
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
      preampGain: 3,
      customPresets: [],
    });

    const state = useEqualizerStore.getState();
    expect(state.enabled).toBe(false);
    expect(state.presetId).toBe("jazz");
    expect(state.preampGain).toBe(3);
    expect([...state.bands]).toEqual([...getBuiltinPreset("jazz")!.bands]);
  });

  it("saveCurrentAsPreset adds preset and selects it", () => {
    useEqualizerStore.getState().setBand(2, 6);

    useEqualizerStore.getState().saveCurrentAsPreset("Saved");

    const state = useEqualizerStore.getState();
    expect(state.customPresets).toHaveLength(1);
    expect(state.customPresets[0]?.name).toBe("Saved");
    expect(state.presetId).toBe(state.customPresets[0]?.id);
    expect(state.bands[2]).toBe(6);
  });

  it("renameCustomPreset updates the preset name", () => {
    useEqualizerStore.setState({ customPresets: [customPreset] });

    useEqualizerStore.getState().renameCustomPreset("custom-1", "Renamed");

    const state = useEqualizerStore.getState();
    expect(state.customPresets[0]?.name).toBe("Renamed");
  });

  it("deleteCustomPreset removes preset and resets active id", () => {
    useEqualizerStore.setState({
      customPresets: [customPreset],
      presetId: "custom-1",
      bands: customPreset.bands,
    });

    useEqualizerStore.getState().deleteCustomPreset("custom-1");

    const state = useEqualizerStore.getState();
    expect(state.customPresets).toHaveLength(0);
    expect(state.presetId).toBe("flat");
    expect([...state.bands]).toEqual([...customPreset.bands]);
  });

  it("cyclePreset wraps built-in presets and skips manual", () => {
    useEqualizerStore.getState().applyPreset("flat");
    useEqualizerStore.getState().cyclePreset("next");
    expect(useEqualizerStore.getState().presetId).toBe("rock");

    useEqualizerStore.getState().applyPreset("flat");
    useEqualizerStore.getState().cyclePreset("prev");
    expect(useEqualizerStore.getState().presetId).toBe("treble");
  });

  it("cyclePreset uses last preset when current is manual", () => {
    useEqualizerStore.getState().applyPreset("jazz");
    useEqualizerStore.getState().setBand(0, 4);

    useEqualizerStore.getState().cyclePreset("next");
    expect(useEqualizerStore.getState().presetId).toBe("classical");
  });
});

import { getBuiltinPreset } from "./equalizer/builtinPresets";
import { FLAT_BAND_GAINS } from "./equalizer/types";
import {
  getEqualizerSettings,
  listEqualizerCustomPresets,
} from "./tauri";
import { recordToPreset, useEqualizerStore } from "../store/useEqualizerStore";

export async function bootstrapEqualizer(): Promise<void> {
  try {
    const [settings, records] = await Promise.all([
      getEqualizerSettings(),
      listEqualizerCustomPresets(),
    ]);
    useEqualizerStore
      .getState()
      .loadCustomPresets(records.map((record) => recordToPreset(record)));
    useEqualizerStore.getState().initializeFromBootstrap(settings);
  } catch (err) {
    console.error("Equalizer bootstrap failed:", err);
    useEqualizerStore.getState().initializeFromBootstrap({
      enabled: true,
      presetId: getBuiltinPreset("flat") ? "flat" : "manual",
      bands: [...FLAT_BAND_GAINS],
      preampGain: 0,
    });
  }
}

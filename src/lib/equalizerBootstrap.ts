import { getBuiltinPreset } from "./equalizer/builtinPresets";
import { FLAT_BAND_GAINS } from "./equalizer/types";
import { getEqualizerSettings } from "./tauri";
import { useEqualizerStore } from "../store/useEqualizerStore";

export async function bootstrapEqualizer(): Promise<void> {
  try {
    const settings = await getEqualizerSettings();
    useEqualizerStore.getState().initializeFromBootstrap(settings);
  } catch (err) {
    console.error("Equalizer bootstrap failed:", err);
    useEqualizerStore.getState().initializeFromBootstrap({
      enabled: true,
      presetId: "flat",
      bands: [...FLAT_BAND_GAINS],
    });
  }
}

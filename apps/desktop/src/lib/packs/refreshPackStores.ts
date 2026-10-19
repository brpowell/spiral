import { invalidateSoundCueCache } from "../packSounds";
import { useItemsVersionStore } from "../../store/useItemsVersionStore";
import { useSkinStore } from "../../store/useSkinStore";
import { useSoundPackStore } from "../../store/useSoundPackStore";
import { useThemeStore } from "../../store/useThemeStore";
import { useVisualizerStore } from "../../store/useVisualizerStore";

/** Reload theme / skin / visualizer / sound pack lists after an item is installed, changed or removed. */
export async function refreshPackContributionStores(): Promise<void> {
  useItemsVersionStore.getState().bump();
  invalidateSoundCueCache();
  await Promise.all([
    useThemeStore.getState().loadThemes(),
    useSkinStore.getState().loadSkins(),
    useVisualizerStore.getState().loadVisualizers(),
    useSoundPackStore.getState().loadSoundPacks(),
  ]);
}

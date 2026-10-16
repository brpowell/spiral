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

/**
 * Registry-only: v1 pack uninstall no longer exists. Unreachable while the registry UI is
 * flagged off (see `REGISTRY_ENABLED`); remove with the registry rework.
 */
export async function uninstallPackWithRefresh(
  ..._args: unknown[]
): Promise<boolean> {
  return false;
}

/** Registry-only: see {@link uninstallPackWithRefresh}. */
export async function rollbackPackWithRefresh(
  ..._args: unknown[]
): Promise<boolean> {
  return false;
}

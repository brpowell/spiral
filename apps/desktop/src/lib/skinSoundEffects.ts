import { convertFileSrc } from "@tauri-apps/api/core";
import { useSkinPreferencesStore } from "../store/useSkinPreferencesStore";
import { useSkinStore } from "../store/useSkinStore";
import { soundEffectsEnabledFromPreferences } from "../types/skinPreferences";
import { evaluateSkinBind, type SkinBindState } from "./skinBinds";
import { resolveCueUrl } from "./packSounds";
import { playOneShot } from "./sfxPlayer";
import type { LoadedSkinPack } from "../types/skin";

/** Bind path → soundEffects key when truthy (last match wins). Falls back to `sound`. */
export function resolveSkinClickSound(
  sound: string | undefined,
  soundWhen: Record<string, string> | undefined,
  state: SkinBindState,
): string | undefined {
  if (soundWhen) {
    let resolved: string | undefined;
    for (const [condition, key] of Object.entries(soundWhen)) {
      if (evaluateSkinBind(condition, state)) {
        resolved = key;
      }
    }
    if (resolved !== undefined) return resolved;
  }
  return sound;
}

function soundAssetUrl(packDir: string, assetPath: string): string {
  return convertFileSrc(`${packDir}/assets/${assetPath}.wav`);
}

/**
 * Play a skin sound key. The skin's own `soundEffects` entry always wins; a key it
 * does not define is treated as a cue and answered by the active sound pack.
 */
export function playSkinSound(
  pack: LoadedSkinPack | null,
  soundKey: string | undefined,
): void {
  if (!soundKey) return;

  const preferences = useSkinPreferencesStore.getState().preferences;
  if (!soundEffectsEnabledFromPreferences(preferences)) return;

  const assetPath = pack?.manifest.soundEffects?.[soundKey];
  if (pack && assetPath) {
    playOneShot(soundAssetUrl(pack.packDir, assetPath));
    return;
  }

  void resolveCueUrl(soundKey).then((url) => {
    if (url) playOneShot(url);
  });
}

export function playActiveSkinSound(soundKey: string | undefined): void {
  playSkinSound(useSkinStore.getState().activePack, soundKey);
}

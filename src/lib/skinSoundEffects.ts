import { Howl } from "howler";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useSkinPreferencesStore } from "../store/useSkinPreferencesStore";
import { useSkinStore } from "../store/useSkinStore";
import { soundEffectsEnabledFromPreferences } from "../types/skinPreferences";
import { evaluateSkinBind, type SkinBindState } from "./skinBinds";
import {
  isPublicSoundContributionId,
  resolveSoundAssetUrl,
} from "./packSounds";
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

const soundCache = new Map<string, Howl>();

function soundAssetUrl(packDir: string, assetPath: string): string {
  return convertFileSrc(`${packDir}/assets/${assetPath}.wav`);
}

function getOrCreateHowl(url: string): Howl {
  const cached = soundCache.get(url);
  if (cached) return cached;

  const howl = new Howl({
    src: [url],
    volume: 1,
    html5: false,
    preload: true,
  });
  soundCache.set(url, howl);
  return howl;
}

function playHowl(url: string): void {
  const howl = getOrCreateHowl(url);
  const playLoaded = () => {
    howl.stop();
    void howl.play();
  };
  if (howl.state() === "loaded") {
    playLoaded();
    return;
  }
  howl.once("load", playLoaded);
  howl.once("loaderror", (_id, err) => {
    console.error("Failed to load skin sound:", url, err);
  });
}

export function playSkinSound(
  pack: LoadedSkinPack | null,
  soundKey: string | undefined,
): void {
  if (!soundKey) return;

  const preferences = useSkinPreferencesStore.getState().preferences;
  if (!soundEffectsEnabledFromPreferences(preferences)) return;

  if (isPublicSoundContributionId(soundKey)) {
    void resolveSoundAssetUrl(soundKey).then((url) => {
      if (url) playHowl(url);
    });
    return;
  }

  if (!pack) return;

  const soundMap = pack.manifest.soundEffects;
  if (!soundMap) return;

  const assetPath = soundMap[soundKey];
  if (!assetPath) return;

  playHowl(soundAssetUrl(pack.packDir, assetPath));
}

export function playActiveSkinSound(soundKey: string | undefined): void {
  playSkinSound(useSkinStore.getState().activePack, soundKey);
}

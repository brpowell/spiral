import { Howl } from "howler";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useSkinPreferencesStore } from "../store/useSkinPreferencesStore";
import { useSkinStore } from "../store/useSkinStore";
import { soundEffectsEnabledFromPreferences } from "../types/skinPreferences";
import type { LoadedSkinPack } from "../types/skin";

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

export function playSkinSound(
  pack: LoadedSkinPack | null,
  soundKey: string | undefined,
): void {
  if (!pack || !soundKey) return;

  const soundMap = pack.manifest.soundEffects;
  if (!soundMap) return;

  const assetPath = soundMap[soundKey];
  if (!assetPath) return;

  const preferences = useSkinPreferencesStore.getState().preferences;
  if (!soundEffectsEnabledFromPreferences(preferences)) return;

  const url = soundAssetUrl(pack.packDir, assetPath);
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

export function playActiveSkinSound(soundKey: string | undefined): void {
  playSkinSound(useSkinStore.getState().activePack, soundKey);
}

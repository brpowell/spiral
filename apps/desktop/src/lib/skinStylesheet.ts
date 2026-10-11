import { convertFileSrc } from "@tauri-apps/api/core";
import type { LoadedSkinPack } from "../types/skin";

export function skinStylesheetUrl(pack: LoadedSkinPack): string | null {
  const sheet = pack.manifest.stylesheet?.trim();
  if (!sheet || !pack.packDir) return null;
  return convertFileSrc(`${pack.packDir}/${sheet}`);
}

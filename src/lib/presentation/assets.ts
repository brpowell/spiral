import { convertFileSrc } from "@tauri-apps/api/core";

/** Resolve a pack-relative asset path to a Tauri asset URL. */
export function vizPackAssetUrl(packDir: string, relativePath: string): string {
  return convertFileSrc(`${packDir}/assets/${relativePath}`);
}

export function vizImageAssetUrl(packDir: string, assetBase: string): string {
  return vizPackAssetUrl(packDir, `${assetBase}.png`);
}

export function vizGifAssetUrl(packDir: string, assetBase: string): string {
  return vizPackAssetUrl(packDir, `${assetBase}.gif`);
}

export function vizVideoAssetUrl(packDir: string, assetBase: string): string {
  return vizPackAssetUrl(packDir, `${assetBase}.webm`);
}

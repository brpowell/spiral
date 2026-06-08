import { convertFileSrc } from "@tauri-apps/api/core";

export type SkinAssetFormat = "png" | "gif";

export function skinAssetUrl(
  packDir: string,
  assetBase: string,
  state?: string,
  format: SkinAssetFormat = "png",
): string {
  const suffix = state && state !== "default" ? `-${state}` : "";
  return convertFileSrc(`${packDir}/assets/${assetBase}${suffix}.${format}`);
}

export function skinPackAssetUrl(packDir: string, assetPath: string): string {
  return convertFileSrc(`${packDir}/assets/${assetPath}.png`);
}

export function skinGifAssetUrl(packDir: string, assetBase: string): string {
  return convertFileSrc(`${packDir}/assets/${assetBase}.gif`);
}

export function skinPreviewUrl(previewPath: string | null): string | null {
  if (!previewPath) return null;
  return convertFileSrc(previewPath);
}

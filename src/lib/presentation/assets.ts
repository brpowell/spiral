import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * Resolve a contribution-relative media path (`assets/foo.webm`) to a Tauri
 * asset URL. Paths include the `assets/` prefix and file extension.
 */
export function vizLayerAssetUrl(packDir: string, asset: string): string {
  return convertFileSrc(`${packDir}/${asset}`);
}

/** URL for image/video scene layers; null for other kinds or missing asset. */
export function vizMediaLayerUrl(
  packDir: string,
  layer: { kind: string; asset?: string },
): string | null {
  if (!layer.asset) return null;
  if (layer.kind !== "image" && layer.kind !== "video") return null;
  return vizLayerAssetUrl(packDir, layer.asset);
}

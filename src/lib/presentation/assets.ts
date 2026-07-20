import { convertFileSrc } from "@tauri-apps/api/core";

const IMAGE_EXTENSIONS = new Set(["png", "webp", "gif"]);
const VIDEO_EXTENSIONS = new Set(["webm", "mp4"]);
const ALL_MEDIA_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
]);

export type VizMediaLayerKind = "image" | "video";

/**
 * True when `asset` is a safe contribution-relative media path
 * (`assets/foo.png`). Rejects traversal, absolute paths, backslashes,
 * schemes/drives, and disallowed extensions.
 */
export function isSafeVizMediaAsset(
  asset: string,
  kind?: VizMediaLayerKind,
): boolean {
  if (!asset || asset.includes("\0")) return false;
  if (asset.startsWith("/") || asset.startsWith("\\")) return false;
  if (asset.includes("\\") || asset.includes(":")) return false;
  if (!asset.startsWith("assets/")) return false;

  const segments = asset.split("/");
  if (segments.length < 2 || segments[0] !== "assets") return false;
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") return false;
  }

  const last = segments[segments.length - 1]!;
  const dot = last.lastIndexOf(".");
  if (dot <= 0 || dot === last.length - 1) return false;
  const ext = last.slice(dot + 1).toLowerCase();

  const allowed =
    kind === "image"
      ? IMAGE_EXTENSIONS
      : kind === "video"
        ? VIDEO_EXTENSIONS
        : ALL_MEDIA_EXTENSIONS;
  return allowed.has(ext);
}

/**
 * Resolve a contribution-relative media path (`assets/foo.webm`) to a Tauri
 * asset URL. Throws if the path fails {@link isSafeVizMediaAsset}.
 */
export function vizLayerAssetUrl(packDir: string, asset: string): string {
  if (!isSafeVizMediaAsset(asset)) {
    throw new Error(`[viz-media] rejected asset path: ${asset}`);
  }
  return convertFileSrc(`${packDir}/${asset}`);
}

/** URL for image/video scene layers; null for other kinds, missing, or unsafe asset. */
export function vizMediaLayerUrl(
  packDir: string,
  layer: { kind: string; asset?: string },
): string | null {
  if (!layer.asset) return null;
  if (layer.kind !== "image" && layer.kind !== "video") return null;
  if (!isSafeVizMediaAsset(layer.asset, layer.kind)) return null;
  return vizLayerAssetUrl(packDir, layer.asset);
}

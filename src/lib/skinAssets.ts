import { convertFileSrc } from "@tauri-apps/api/core";
import { evaluateSkinBind } from "./skinBinds";
import type { SkinBindState } from "./skinBinds";
import type {
  InteractiveAssets,
  InteractiveAssetsWhen,
  InteractiveAssetState,
  SkinAssetFile,
} from "../types/skin";

/** True when the asset path refers to an animated GIF. */
export function isSkinGifAsset(file: SkinAssetFile): boolean {
  return file.toLowerCase().endsWith(".gif");
}

/** True when a resolved skin asset URL refers to an animated GIF. */
export function isSkinGifUrl(url: string): boolean {
  const path = url.split("?")[0]?.split("#")[0] ?? url;
  return path.toLowerCase().endsWith(".gif");
}

export function interactiveAssetsUseGif(
  assets: InteractiveAssets,
  assetsWhen: InteractiveAssetsWhen | undefined,
  bindState: SkinBindState,
): boolean {
  const resolved = resolveInteractiveAssets(assets, assetsWhen, bindState);
  return [resolved.default, resolved.hover, resolved.pressed]
    .filter((file): file is SkinAssetFile => Boolean(file))
    .some(isSkinGifAsset);
}

/** Resolve a pack-relative asset file path to a Tauri asset URL. */
export function skinAssetFileUrl(
  packDir: string,
  relativeFile: SkinAssetFile,
): string {
  return convertFileSrc(`${packDir}/assets/${relativeFile}`);
}

export function resolveInteractiveAssets(
  assets: InteractiveAssets,
  assetsWhen: InteractiveAssetsWhen | undefined,
  bindState: SkinBindState,
): InteractiveAssets {
  if (!assetsWhen) return assets;

  let resolved = assets;
  for (const [bindPath, variant] of Object.entries(assetsWhen)) {
    if (evaluateSkinBind(bindPath, bindState)) {
      resolved = variant;
    }
  }
  return resolved;
}

export function resolveInteractiveAssetFile(
  assets: InteractiveAssets,
  assetsWhen: InteractiveAssetsWhen | undefined,
  bindState: SkinBindState,
  state: InteractiveAssetState,
): SkinAssetFile {
  const active = resolveInteractiveAssets(assets, assetsWhen, bindState);
  if (state === "default") return active.default;
  if (state === "hover") return active.hover ?? active.default;
  return active.pressed ?? active.default;
}

export function resolveInteractiveAssetUrl(
  packDir: string,
  assets: InteractiveAssets,
  assetsWhen: InteractiveAssetsWhen | undefined,
  bindState: SkinBindState,
  state: InteractiveAssetState,
): string {
  return skinAssetFileUrl(
    packDir,
    resolveInteractiveAssetFile(assets, assetsWhen, bindState, state),
  );
}

/** Collect every bitmap file referenced by an asset set and its bind variants. */
export function collectBitmapAssetFiles(
  assets: InteractiveAssets,
  assetsWhen?: InteractiveAssetsWhen,
): SkinAssetFile[] {
  const files = new Set<SkinAssetFile>();
  const addSet = (set: InteractiveAssets) => {
    files.add(set.default);
    if (set.hover) files.add(set.hover);
    if (set.pressed) files.add(set.pressed);
  };
  addSet(assets);
  if (assetsWhen) {
    for (const variant of Object.values(assetsWhen)) {
      addSet(variant);
    }
  }
  return [...files];
}

export function skinPreviewUrl(previewPath: string | null): string | null {
  if (!previewPath) return null;
  return convertFileSrc(previewPath);
}

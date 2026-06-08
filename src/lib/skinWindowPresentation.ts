import { convertFileSrc } from "@tauri-apps/api/core";
import type { CSSProperties } from "react";
import type { LoadedSkinPack, SkinManifest, SkinView } from "../types/skin";

export function resolveSkinWindowBackgroundStyle(
  pack: LoadedSkinPack,
): CSSProperties | undefined {
  const background = pack.manifest.window?.background;
  if (!background || !pack.packDir) return undefined;
  return {
    backgroundImage: `url("${convertFileSrc(`${pack.packDir}/${background}`)}")`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  };
}

export function resolveViewLayoutMode(view: SkinView): "slots" | "canvas" {
  return view.layoutMode === "canvas" ? "canvas" : "slots";
}

export function resolveCanvasSize(
  view: SkinView,
  manifest: SkinManifest,
): { width: number; height: number } {
  return {
    width:
      view.canvas?.width ??
      manifest.window?.defaultWidth ??
      320,
    height:
      view.canvas?.height ??
      manifest.window?.defaultHeight ??
      440,
  };
}

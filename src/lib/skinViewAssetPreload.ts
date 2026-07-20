import type {
  InteractiveAssets,
  InteractiveAssetsWhen,
  LayoutNode,
  LoadedSkinPack,
  StripSliderPresentation,
} from "../types/skin";
import { loadStripSliderPositionMap } from "./skinStripSliderMap";
import { loadSkinGif } from "./skinGifPlayback";
import { loadSkinBitmap } from "./skinBitmapCache";
import {
  collectBitmapAssetFiles,
  isSkinGifUrl,
  skinAssetFileUrl,
} from "./skinAssets";

function addBitmapAssetUrls(
  packDir: string,
  assets: InteractiveAssets,
  assetsWhen: InteractiveAssetsWhen | undefined,
  urls: Set<string>,
): void {
  for (const file of collectBitmapAssetFiles(assets, assetsWhen)) {
    urls.add(skinAssetFileUrl(packDir, file));
  }
}

function addStripSliderAssets(
  packDir: string,
  presentation: StripSliderPresentation,
  urls: Set<string>,
): void {
  urls.add(skinAssetFileUrl(packDir, presentation.strip));
  if (presentation.positionMap) {
    urls.add(skinAssetFileUrl(packDir, presentation.positionMap));
  }
}

function collectLayoutAssetUrls(
  node: LayoutNode,
  packDir: string,
  urls: Set<string>,
): void {
  switch (node.type) {
    case "canvas":
    case "subview":
    case "stack":
    case "row":
    case "column":
    case "overlay":
    case "region":
      for (const child of node.children) {
        collectLayoutAssetUrls(child, packDir, urls);
      }
      return;
    case "decoration":
      if (node.presentation.kind === "bitmap") {
        addBitmapAssetUrls(
          packDir,
          node.presentation.assets,
          node.presentation.assetsWhen,
          urls,
        );
      } else if (node.presentation.kind === "gif") {
        urls.add(skinAssetFileUrl(packDir, node.presentation.asset));
      }
      return;
    case "button":
      if (node.presentation.kind === "bitmap") {
        addBitmapAssetUrls(
          packDir,
          node.presentation.assets,
          node.presentation.assetsWhen,
          urls,
        );
      }
      return;
    case "buttonGroup":
      if (node.presentation.kind === "buttonGroup") {
        addBitmapAssetUrls(
          packDir,
          node.presentation.assets,
          node.presentation.assetsWhen,
          urls,
        );
        urls.add(skinAssetFileUrl(packDir, node.presentation.positionMap));
      }
      return;
    case "eqBand":
    case "balance":
    case "volume":
    case "seekbar":
      if (
        node.presentation.kind === "bitmapVerticalSlider" ||
        node.presentation.kind === "bitmapHorizontalSlider"
      ) {
        if (node.presentation.track) {
          urls.add(skinAssetFileUrl(packDir, node.presentation.track));
        }
        urls.add(skinAssetFileUrl(packDir, node.presentation.thumb));
        if (
          node.presentation.kind === "bitmapVerticalSlider" &&
          node.presentation.thumbPressed
        ) {
          urls.add(skinAssetFileUrl(packDir, node.presentation.thumbPressed));
        }
      } else if (node.presentation.kind === "bitmapSeekbar") {
        urls.add(skinAssetFileUrl(packDir, node.presentation.track));
        urls.add(skinAssetFileUrl(packDir, node.presentation.fill));
        addBitmapAssetUrls(
          packDir,
          node.presentation.thumbAssets,
          undefined,
          urls,
        );
      } else if (node.presentation.kind === "stripSlider") {
        addStripSliderAssets(packDir, node.presentation, urls);
      }
      return;
    case "visualizer":
      if (node.presentation.kind === "framedPanel") {
        urls.add(skinAssetFileUrl(packDir, node.presentation.mask));
        if (node.presentation.frame) {
          urls.add(skinAssetFileUrl(packDir, node.presentation.frame));
        }
      }
      return;
    case "time":
      if (node.presentation.kind === "digitStrip") {
        urls.add(skinAssetFileUrl(packDir, node.presentation.strip));
      }
      return;
    case "scrollStrip":
      if (node.presentation.kind === "bitmapVertical") {
        for (const item of node.presentation.items) {
          urls.add(skinAssetFileUrl(packDir, item.asset));
        }
      }
      return;
    case "tiledFrame":
      if ("tiles" in node.presentation) {
        for (const tile of node.presentation.tiles) {
          urls.add(skinAssetFileUrl(packDir, tile.asset));
        }
      } else {
        for (const asset of Object.values(node.presentation.assets)) {
          if (asset) {
            urls.add(skinAssetFileUrl(packDir, asset));
          }
        }
      }
      for (const child of node.children) {
        collectLayoutAssetUrls(child, packDir, urls);
      }
      return;
    default:
      return;
  }
}

function stripSliderDirection(
  node: Extract<LayoutNode, { type: "eqBand" | "volume" | "seekbar" }>,
  presentation: StripSliderPresentation,
): "horizontal" | "vertical" {
  if (presentation.direction) return presentation.direction;
  return node.type === "volume" || node.type === "eqBand"
    ? "vertical"
    : "horizontal";
}

async function warmLayoutStripSliderMaps(
  node: LayoutNode,
  packDir: string,
): Promise<void> {
  switch (node.type) {
    case "canvas":
    case "subview":
    case "stack":
    case "row":
    case "column":
    case "overlay":
    case "region":
    case "tiledFrame":
      await Promise.all(
        node.children.map((child) => warmLayoutStripSliderMaps(child, packDir)),
      );
      return;
    case "eqBand":
    case "volume":
    case "seekbar": {
      const presentation = node.presentation;
      if (presentation.kind !== "stripSlider" || !presentation.positionMap) {
        return;
      }
      const mapUrl = skinAssetFileUrl(packDir, presentation.positionMap);
      const stripUrl = skinAssetFileUrl(packDir, presentation.strip);
      const direction = stripSliderDirection(node, presentation);
      const defaultFrameHeight =
        node.type === "volume" ? 128 : node.type === "eqBand" ? 116 : 113;
      try {
        await loadStripSliderPositionMap(
          mapUrl,
          presentation.frameCount,
          direction,
          {
            stripUrl,
            frameWidth: presentation.frameWidth,
            frameHeight: presentation.frameHeight ?? defaultFrameHeight,
            mapFrames: presentation.mapFrames,
          },
        );
      } catch (err) {
        console.warn("warmLayoutStripSliderMaps:", err);
      }
      return;
    }
    default:
      return;
  }
}

function decodeAssetUrl(url: string, isGif = false): Promise<void> {
  if (isGif) {
    return loadSkinGif(url).then(() => undefined);
  }
  return loadSkinBitmap(url).then(() => undefined);
}

export async function preloadSkinViewAssets(
  pack: LoadedSkinPack,
  viewId: string,
): Promise<void> {
  const view = pack.manifest.views[viewId];
  if (!view) return;

  const urls = new Set<string>();
  collectLayoutAssetUrls(view.layout, pack.packDir, urls);

  await Promise.all([
    ...[...urls].map(async (url) => {
      try {
        await decodeAssetUrl(url, isSkinGifUrl(url));
      } catch (err) {
        console.warn("preloadSkinViewAssets:", err);
      }
    }),
    warmLayoutStripSliderMaps(view.layout, pack.packDir),
  ]);
}

import type { LayoutNode, LoadedSkinPack, StripSliderPresentation } from "../types/skin";
import { loadStripSliderPositionMap } from "./skinStripSliderMap";
import { loadSkinGif } from "./skinGifPlayback";
import { skinAssetUrl, skinGifAssetUrl, skinPackAssetUrl } from "./skinAssets";

function addBitmapButtonAssets(
  packDir: string,
  assetBase: string,
  urls: Set<string>,
  animatedHover?: boolean,
): void {
  urls.add(skinAssetUrl(packDir, assetBase));
  urls.add(
    skinAssetUrl(
      packDir,
      assetBase,
      "hover",
      animatedHover ? "gif" : "png",
    ),
  );
  urls.add(skinAssetUrl(packDir, assetBase, "pressed"));
}

function addStripSliderAssets(
  packDir: string,
  presentation: StripSliderPresentation,
  urls: Set<string>,
): void {
  urls.add(skinPackAssetUrl(packDir, presentation.strip));
  if (presentation.positionMap) {
    urls.add(skinPackAssetUrl(packDir, presentation.positionMap));
  }
}

function collectLayoutAssetUrls(
  node: LayoutNode,
  packDir: string,
  urls: Set<string>,
): void {
  switch (node.type) {
    case "canvas":
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
        urls.add(skinAssetUrl(packDir, node.presentation.assetBase));
      } else if (node.presentation.kind === "gif") {
        urls.add(skinGifAssetUrl(packDir, node.presentation.assetBase));
      }
      return;
    case "button":
      if (node.presentation.kind === "bitmap") {
        addBitmapButtonAssets(
          packDir,
          node.presentation.assetBase,
          urls,
          node.presentation.animatedHover,
        );
      }
      return;
    case "buttonGroup":
      if (node.presentation.kind === "buttonGroup") {
        addBitmapButtonAssets(
          packDir,
          node.presentation.assetBase,
          urls,
          node.presentation.animatedHover,
        );
        urls.add(skinPackAssetUrl(packDir, node.presentation.positionMap));
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
        urls.add(skinAssetUrl(packDir, node.presentation.track));
        urls.add(skinAssetUrl(packDir, node.presentation.thumb));
      } else if (node.presentation.kind === "stripSlider") {
        addStripSliderAssets(packDir, node.presentation, urls);
      }
      return;
    case "visualizer":
      if (node.presentation.kind === "framedPanel") {
        urls.add(skinAssetUrl(packDir, node.presentation.mask));
        if (node.presentation.frame) {
          urls.add(skinAssetUrl(packDir, node.presentation.frame));
        }
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
    case "stack":
    case "row":
    case "column":
    case "overlay":
    case "region":
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
      const mapUrl = skinPackAssetUrl(packDir, presentation.positionMap);
      const stripUrl = skinPackAssetUrl(packDir, presentation.strip);
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
  return fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to fetch skin asset: ${response.status}`);
      }
      return response.blob();
    })
    .then(
      (blob) =>
        new Promise<void>((resolve, reject) => {
          const objectUrl = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve();
          };
          img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error(`Failed to decode skin asset: ${url}`));
          };
          img.src = objectUrl;
        }),
    );
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
        await decodeAssetUrl(url, url.endsWith(".gif"));
      } catch (err) {
        console.warn("preloadSkinViewAssets:", err);
      }
    }),
    warmLayoutStripSliderMaps(view.layout, pack.packDir),
  ]);
}

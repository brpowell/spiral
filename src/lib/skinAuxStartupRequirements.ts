import type { LayoutTreeNode, LoadedSkinPack } from "../types/skin";

export interface AuxStartupRequirements {
  /** Player store bridge — always true for aux windows today. */
  player: boolean;
  /** EQ bridge for eq views or layouts with EQ slider nodes. */
  eq: boolean;
  /** Visualizer bootstrap + bridge for viz views or visualizer nodes. */
  visualizer: boolean;
  /** Playlist store load for layouts with playlist nodes. */
  playlists: boolean;
  /** Theme bootstrap + bridge for slot-based (non-canvas) aux views. */
  theme: boolean;
}

interface LayoutFeatureFlags {
  eq: boolean;
  visualizer: boolean;
  playlist: boolean;
}

function walkLayoutFeatures(
  node: LayoutTreeNode,
  flags: LayoutFeatureFlags,
): void {
  switch (node.type) {
    case "canvas":
    case "subview":
    case "row":
    case "column":
    case "overlay":
    case "tiledFrame":
      for (const child of node.children) {
        walkLayoutFeatures(child, flags);
      }
      return;
    case "slider":
      if (node.control === "eq") {
        flags.eq = true;
      }
      return;
    case "visualizer":
      flags.visualizer = true;
      return;
    case "playlist":
      flags.playlist = true;
      return;
    default:
      return;
  }
}

export function resolveAuxStartupRequirements(
  pack: LoadedSkinPack,
  viewId: string,
): AuxStartupRequirements {
  const view = pack.manifest.views[viewId];
  if (!view) {
    return {
      player: true,
      eq: false,
      visualizer: false,
      playlists: false,
      theme: true,
    };
  }

  const flags: LayoutFeatureFlags = {
    eq: false,
    visualizer: false,
    playlist: false,
  };
  walkLayoutFeatures(view.layout, flags);

  const isCanvasView = view.layout.type === "canvas";

  return {
    player: true,
    eq: flags.eq,
    visualizer: flags.visualizer,
    playlists: flags.playlist,
    theme: !isCanvasView,
  };
}

import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { LoadedSkinPack, SkinView } from "../types/skin";
import {
  resolvePanelWindowSize,
  type PanelOpenState,
} from "./skinPanels";
import {
  resolvePackWindowChrome,
  sanitizeWindowSize,
  suppressSkinModeSnap,
} from "./skinModeWindowChrome";

/** Resize the native skin window for panel state without reflowing the canvas stage. */
export async function applyPanelWindowSize(
  pack: LoadedSkinPack,
  view: SkinView,
  panelOpen: PanelOpenState,
): Promise<void> {
  const chrome = resolvePackWindowChrome(pack);
  const target = resolvePanelWindowSize(view, pack.manifest, panelOpen);
  const { width, height } = sanitizeWindowSize(target.width, target.height, {
    ...chrome,
    maxWidth: Math.max(chrome.maxWidth, target.width),
    maxHeight: Math.max(chrome.maxHeight, target.height),
  });

  suppressSkinModeSnap();
  try {
    await getCurrentWindow().setSize(new LogicalSize(width, height));
  } finally {
    suppressSkinModeSnap();
  }
}

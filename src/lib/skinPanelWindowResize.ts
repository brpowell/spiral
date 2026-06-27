import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { SkinView } from "../types/skin";
import {
  resolvePanelWindowSize,
  type PanelOpenState,
} from "./skinPanels";
import {
  resolveWindowChrome,
  sanitizeWindowSize,
  suppressSkinModeSnap,
} from "./skinModeWindowChrome";

/** Resize the native skin window for panel state without reflowing the canvas stage. */
export async function applyPanelWindowSize(
  view: SkinView,
  panelOpen: PanelOpenState,
): Promise<void> {
  const chrome = resolveWindowChrome(view.window);
  const target = resolvePanelWindowSize(view, panelOpen);
  const relaxedChrome =
    chrome.maxWidth !== undefined || chrome.maxHeight !== undefined
      ? {
          ...chrome,
          ...(chrome.maxWidth !== undefined
            ? { maxWidth: Math.max(chrome.maxWidth, target.width) }
            : {}),
          ...(chrome.maxHeight !== undefined
            ? { maxHeight: Math.max(chrome.maxHeight, target.height) }
            : {}),
        }
      : chrome;
  const { width, height } = sanitizeWindowSize(
    target.width,
    target.height,
    relaxedChrome,
  );

  suppressSkinModeSnap();
  try {
    await getCurrentWindow().setSize(new LogicalSize(width, height));
  } finally {
    suppressSkinModeSnap();
  }
}

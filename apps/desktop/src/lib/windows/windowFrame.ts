import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

/**
 * Native frame around a custom-chrome window (Linux only, see
 * `linux_window_frame.rs`): GTK draws the shadow and rounded corners, and
 * the page clips itself to match.
 */
export interface WindowFrame {
  enabled: boolean;
  /** False while maximized, tiled or fullscreen. */
  rounded: boolean;
}

/** Emitted by the backend when the window's corners change. */
export const WINDOW_FRAME_EVENT = "spiral:window-frame";

/** `data-window-frame` drives the clip in `CustomWindowFrame.css`. */
export function setWindowFrameAttribute(
  root: HTMLElement,
  frame: WindowFrame,
): void {
  if (!frame.enabled) {
    delete root.dataset.windowFrame;
    return;
  }
  root.dataset.windowFrame = frame.rounded ? "rounded" : "square";
}

/** Turn the frame on for this window and keep the page's corners in sync. */
export async function installWindowFrame(
  root: HTMLElement = document.documentElement,
): Promise<void> {
  // Listen first so a state change during the invoke isn't lost.
  const unlisten = await getCurrentWebviewWindow().listen<boolean>(
    WINDOW_FRAME_EVENT,
    (event) => {
      setWindowFrameAttribute(root, { enabled: true, rounded: event.payload });
    },
  );
  let frame: WindowFrame | undefined;
  try {
    frame = await invoke<WindowFrame>("window_frame");
    setWindowFrameAttribute(root, frame);
  } finally {
    if (!frame?.enabled) unlisten();
  }
}

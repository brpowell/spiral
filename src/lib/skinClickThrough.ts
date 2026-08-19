import { invoke } from "@tauri-apps/api/core";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import {
  isOverSkinWindowContent,
  primeSkinArtworkAlphaFromDom,
} from "./skinWindowHit";

/**
 * Canvas skins render in a transparent frameless window. Empty stage margins
 * (Headspace drawer reserve) and transparent pixels inside irregular artwork
 * (the head silhouette) must pass clicks through to the desktop / windows
 * behind the skin.
 *
 * This manager toggles the OS-level ignore-cursor flag based on whether the
 * cursor sits over opaque artwork or controls. See `isOverSkinWindowContent`
 * for the per-pixel hit test. On macOS a focused app still receives clicks
 * unless it deactivates — `set_skin_ignore_cursor_events` ignores mouse
 * events and deactivates so the hardware click goes through immediately.
 */

const POLL_INTERVAL_MS = 40;

export interface SkinClickThroughOptions {
  /** When true, the window stays fully interactive (drawer/shutter motion). */
  shouldSuspend?: () => boolean;
}

export function setSkinClickThroughIgnore(ignore: boolean): Promise<void> {
  return invoke("set_skin_ignore_cursor_events", { ignore });
}

export function startSkinClickThrough(
  options: SkinClickThroughOptions = {},
): () => void {
  const appWindow = getCurrentWindow();
  let ignoring = false;
  let disposed = false;
  let pollTimer: number | null = null;
  let activePointers = 0;

  const stopPolling = () => {
    if (pollTimer === null) return;
    window.clearInterval(pollTimer);
    pollTimer = null;
  };

  const setIgnore = (next: boolean, force = false) => {
    if (!force && next === ignoring) return;
    ignoring = next;
    void setSkinClickThroughIgnore(next).catch(() => {});
  };

  const shouldStayInteractive = () =>
    activePointers > 0 || options.shouldSuspend?.() === true;

  const syncPassThrough = (clientX: number, clientY: number) => {
    if (shouldStayInteractive() || isOverSkinWindowContent(clientX, clientY)) {
      setIgnore(false);
      return;
    }
    setIgnore(true);
  };

  // Poll even while interactive: holes must start ignoring before the click
  // arrives. While ignoring, the webview gets no pointer events, so polling is
  // the only way to detect re-entry onto artwork/controls.
  const poll = async () => {
    if (disposed) return;
    try {
      const [cursor, innerOrigin, scaleFactor] = await Promise.all([
        cursorPosition(),
        appWindow.innerPosition(),
        appWindow.scaleFactor(),
      ]);
      const clientX = (cursor.x - innerOrigin.x) / scaleFactor;
      const clientY = (cursor.y - innerOrigin.y) / scaleFactor;
      syncPassThrough(clientX, clientY);
    } catch {
      // Transient IPC failures are non-fatal; the next tick retries.
    }
  };

  pollTimer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
  void poll();

  const onHoleEvent = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    setIgnore(true, true);
  };

  const onDown = (event: Event) => {
    const point = event as PointerEvent | MouseEvent;
    if (!isOverSkinWindowContent(point.clientX, point.clientY)) {
      onHoleEvent(event);
      return;
    }
    if (event.type === "mousedown") return;
    activePointers += 1;
    setIgnore(false);
  };

  const onPointerUp = (event: PointerEvent) => {
    activePointers = Math.max(0, activePointers - 1);
    if (activePointers === 0) {
      syncPassThrough(event.clientX, event.clientY);
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (ignoring) return;
    syncPassThrough(event.clientX, event.clientY);
  };

  const onContextMenu = (event: Event) => {
    const point = event as MouseEvent;
    if (!isOverSkinWindowContent(point.clientX, point.clientY)) {
      onHoleEvent(event);
    }
  };

  const onWindowFocus = () => {
    if (ignoring) setIgnore(true, true);
  };

  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("mousedown", onDown, true);
  window.addEventListener("contextmenu", onContextMenu, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("focus", onWindowFocus);
  primeSkinArtworkAlphaFromDom();
  const primeTimer = window.setTimeout(() => primeSkinArtworkAlphaFromDom(), 0);

  return () => {
    disposed = true;
    window.clearTimeout(primeTimer);
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("mousedown", onDown, true);
    window.removeEventListener("contextmenu", onContextMenu, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("pointercancel", onPointerUp, true);
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("focus", onWindowFocus);
    stopPolling();
    if (ignoring) void setSkinClickThroughIgnore(false).catch(() => {});
  };
}

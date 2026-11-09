import { invoke } from "@tauri-apps/api/core";
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
 * for the per-pixel hit test. On macOS, `ignoresMouseEvents` is enough — do
 * not resign key or deactivate the app, which would make the next click pay
 * a synchronous accessibility query on the main thread.
 *
 * Polling uses a native AppKit (or Tauri) cursor→client mapping. JS
 * `cursorPosition()` / `innerPosition()` / `window.screenX` disagree on a
 * left-of-primary display; an out-of-view poll must not change ignore state.
 */

const POLL_INTERVAL_MS = 40;

export interface SkinClickThroughOptions {
  /** When true, the window stays fully interactive (drawer/shutter motion). */
  shouldSuspend?: () => boolean;
}

export function setSkinClickThroughIgnore(ignore: boolean): Promise<void> {
  return invoke("set_skin_ignore_cursor_events", { ignore });
}

export function clientPointInViewport(
  clientX: number,
  clientY: number,
  viewport: { width: number; height: number },
): boolean {
  return (
    clientX >= 0 &&
    clientY >= 0 &&
    clientX <= viewport.width &&
    clientY <= viewport.height
  );
}

export type SkinPassThroughDecision = "ignore" | "interactive" | "hold";

/**
 * Poll may change ignore-cursor only when the mapped point is inside the
 * webview. An out-of-view poll is untrusted and must not force interactive.
 * A press in flight must not retarget ignore either.
 */
export function decidePolledPassThrough(args: {
  inView: boolean;
  overContent: boolean;
  stayInteractive: boolean;
  /** OS mouse buttons currently down. Never retarget ignore mid-press. */
  buttonsDown: boolean;
}): SkinPassThroughDecision {
  if (args.stayInteractive) return "interactive";
  if (args.buttonsDown) return "hold";
  if (!args.inView) return "hold";
  return args.overContent ? "interactive" : "ignore";
}

function getSkinCursorClientPosition(): Promise<{
  x: number;
  y: number;
  buttons?: number;
}> {
  return invoke("get_skin_cursor_client_position");
}

export function startSkinClickThrough(
  options: SkinClickThroughOptions = {},
): () => void {
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

  const syncPassThrough = (clientX: number, clientY: number, buttons = 0) => {
    const view = {
      width: window.innerWidth,
      height: window.innerHeight,
    };
    const inView = clientPointInViewport(clientX, clientY, view);
    const overContent =
      inView && isOverSkinWindowContent(clientX, clientY, document, view);
    const decision = decidePolledPassThrough({
      inView,
      overContent,
      stayInteractive: shouldStayInteractive(),
      buttonsDown: buttons !== 0,
    });
    if (decision === "hold") return;
    setIgnore(decision === "ignore");
  };

  // Poll even while interactive: holes must start ignoring before the click
  // arrives. While ignoring, the webview gets no pointer events, so polling is
  // the only way to detect re-entry onto artwork/controls.
  const poll = async () => {
    if (disposed) return;
    try {
      const {
        x: clientX,
        y: clientY,
        buttons = 0,
      } = await getSkinCursorClientPosition();
      syncPassThrough(clientX, clientY, buttons);
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
      syncPassThrough(event.clientX, event.clientY, event.buttons);
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (ignoring) return;
    syncPassThrough(event.clientX, event.clientY, event.buttons);
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

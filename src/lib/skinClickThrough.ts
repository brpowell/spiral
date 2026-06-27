import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import type { PanelOpenState } from "./skinPanels";

/**
 * Canvas skins (e.g. Headspace) render on a fixed stage that is wider/taller
 * than the visible artwork, so the transparent native window keeps margins
 * reserved for panel drawers. Without click-through, those transparent margins
 * still swallow clicks meant for windows behind the skin.
 *
 * This manager toggles the OS-level `setIgnoreCursorEvents` flag based on
 * whether the cursor sits over interactive skin content. Empty stage margins
 * and transparent padding stay click-through; drag regions and controls count
 * as solid so the window receives input there.
 */

const POLL_INTERVAL_MS = 40;
/** Delay before enabling pass-through so brief crossings of transparent gaps don't stick. */
const ENABLE_PASS_THROUGH_MS = 120;

export interface SkinClickThroughOptions {
  /** When true, the window stays fully interactive (panel motion, open drawers). */
  shouldSuspend?: () => boolean;
}

/** True while a panel is opening, closing, or left open/revealed. */
export function isSkinPanelInteractionActive(
  panelOpen: PanelOpenState,
  panelRevealed: PanelOpenState,
  panelSettled: PanelOpenState,
): boolean {
  const ids = new Set([
    ...Object.keys(panelOpen),
    ...Object.keys(panelRevealed),
    ...Object.keys(panelSettled),
  ]);
  for (const id of ids) {
    const open = panelOpen[id] ?? false;
    const revealed = panelRevealed[id] ?? false;
    const settled = panelSettled[id] ?? true;
    if (open || revealed || !settled) return true;
  }
  return false;
}

/**
 * True when the point lands on skin artwork or controls rather than empty stage.
 *
 * Checks layout bounds directly so passthrough decorations still count: they use
 * pointer-events: none so clicks reach the stage drag region, but those bounds must
 * not trigger OS click-through on panel skins like Headspace.
 */
function isOverSkinContent(clientX: number, clientY: number): boolean {
  if (
    clientX < 0 ||
    clientY < 0 ||
    clientX > window.innerWidth ||
    clientY > window.innerHeight
  ) {
    return false;
  }
  for (const el of document.querySelectorAll(".skin-bounds")) {
    const rect = el.getBoundingClientRect();
    if (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ) {
      return true;
    }
  }
  return false;
}

export function startSkinClickThrough(
  options: SkinClickThroughOptions = {},
): () => void {
  const appWindow = getCurrentWindow();
  let ignoring = false;
  let disposed = false;
  let pollTimer: number | null = null;
  let activePointers = 0;
  let enableTimer: number | null = null;
  let lastClientX = 0;
  let lastClientY = 0;

  const clearEnableTimer = () => {
    if (enableTimer === null) return;
    window.clearTimeout(enableTimer);
    enableTimer = null;
  };

  const stopPolling = () => {
    if (pollTimer === null) return;
    window.clearInterval(pollTimer);
    pollTimer = null;
  };

  const setIgnore = (next: boolean) => {
    if (next === ignoring) return;
    ignoring = next;
    void appWindow.setIgnoreCursorEvents(next).catch(() => {});
    if (next) startPolling();
    else stopPolling();
  };

  const shouldStayInteractive = () =>
    activePointers > 0 || options.shouldSuspend?.() === true;

  const syncPassThrough = (
    clientX: number,
    clientY: number,
    source: string,
  ) => {
    lastClientX = clientX;
    lastClientY = clientY;
    if (shouldStayInteractive() || isOverSkinContent(clientX, clientY)) {
      clearEnableTimer();
      setIgnore(false);
      return;
    }
    if (ignoring || source === "poll") return;
    clearEnableTimer();
    enableTimer = window.setTimeout(() => {
      enableTimer = null;
      if (disposed || shouldStayInteractive()) return;
      if (isOverSkinContent(lastClientX, lastClientY)) return;
      setIgnore(true);
    }, ENABLE_PASS_THROUGH_MS);
  };

  // While we ignore cursor events the webview receives no pointer events, so we
  // poll the OS cursor to detect when it re-enters real content.
  const poll = async () => {
    if (disposed || !ignoring) return;
    try {
      const [cursor, innerOrigin, scaleFactor] = await Promise.all([
        cursorPosition(),
        appWindow.innerPosition(),
        appWindow.scaleFactor(),
      ]);
      const clientX = (cursor.x - innerOrigin.x) / scaleFactor;
      const clientY = (cursor.y - innerOrigin.y) / scaleFactor;
      syncPassThrough(clientX, clientY, "poll");
    } catch {
      // Transient IPC failures are non-fatal; the next tick retries.
    }
  };

  function startPolling() {
    if (pollTimer !== null) return;
    pollTimer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
  }

  const onPointerDown = () => {
    activePointers += 1;
    clearEnableTimer();
    setIgnore(false);
  };

  const onPointerUp = (event: PointerEvent) => {
    activePointers = Math.max(0, activePointers - 1);
    if (activePointers === 0) {
      syncPassThrough(event.clientX, event.clientY, "pointerup");
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (ignoring) return;
    syncPassThrough(event.clientX, event.clientY, "pointermove");
  };

  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);
  window.addEventListener("pointermove", onPointerMove, true);

  return () => {
    disposed = true;
    clearEnableTimer();
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("pointercancel", onPointerUp, true);
    window.removeEventListener("pointermove", onPointerMove, true);
    stopPolling();
    if (ignoring) void appWindow.setIgnoreCursorEvents(false).catch(() => {});
  };
}

import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";

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

/** True when the point lands on interactive skin content rather than empty stage. */
function isOverSkinContent(clientX: number, clientY: number): boolean {
  if (
    clientX < 0 ||
    clientY < 0 ||
    clientX > window.innerWidth ||
    clientY > window.innerHeight
  ) {
    return false;
  }
  const el = document.elementFromPoint(clientX, clientY);
  return Boolean(el?.closest(".skin-bounds"));
}

export function startSkinClickThrough(): () => void {
  const appWindow = getCurrentWindow();
  let ignoring = false;
  let disposed = false;
  let pollTimer: number | null = null;

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

  // While we ignore cursor events the webview receives no pointer events, so we
  // poll the OS cursor to detect when it re-enters real content.
  const poll = async () => {
    if (disposed || !ignoring) return;
    try {
      const [cursor, origin] = await Promise.all([
        cursorPosition(),
        appWindow.outerPosition(),
      ]);
      const dpr = window.devicePixelRatio || 1;
      const clientX = (cursor.x - origin.x) / dpr;
      const clientY = (cursor.y - origin.y) / dpr;
      if (isOverSkinContent(clientX, clientY)) {
        setIgnore(false);
      }
    } catch {
      // Transient IPC failures are non-fatal; the next tick retries.
    }
  };

  function startPolling() {
    if (pollTimer !== null) return;
    pollTimer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
  }

  // While interactive, real pointer moves drive the hit test with no IPC.
  const onPointerMove = (event: PointerEvent) => {
    if (ignoring) return;
    setIgnore(!isOverSkinContent(event.clientX, event.clientY));
  };

  window.addEventListener("pointermove", onPointerMove, true);

  return () => {
    disposed = true;
    window.removeEventListener("pointermove", onPointerMove, true);
    stopPolling();
    if (ignoring) void appWindow.setIgnoreCursorEvents(false).catch(() => {});
  };
}

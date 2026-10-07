import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

/** Emitted from each webview after its React tree has mounted listeners. */
export const WINDOW_READY_EVENT = "spiral:window-ready";

const WINDOW_READY_TIMEOUT_MS = 8000;

interface WindowReadyWait {
  promise: Promise<void>;
  cancel: () => void;
}

function listenForWindowReady(label: string): WindowReadyWait {
  let unlisten: UnlistenFn | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;

  const finish = () => {
    if (settled) return;
    settled = true;
    if (timer !== undefined) clearTimeout(timer);
    unlisten?.();
  };

  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`window "${label}" did not signal ready`);
      finish();
      resolve();
    }, WINDOW_READY_TIMEOUT_MS);

    void listen<{ label: string }>(WINDOW_READY_EVENT, (event) => {
      if (event.payload?.label !== label) return;
      finish();
      resolve();
    }).then((fn) => {
      if (settled) fn();
      else unlisten = fn;
    });
  });

  return { promise, cancel: finish };
}

/**
 * Create the window when it is not already resident. Waits until a newly
 * created webview has mounted before returning, so the caller can show it
 * and emit follow-up events the page is already listening for.
 */
export async function ensureAppWindow(
  label: string,
): Promise<WebviewWindow | null> {
  const ready = listenForWindowReady(label);
  try {
    const result = await invoke<{ created: boolean }>("ensure_app_window", {
      label,
    });
    const window = await WebviewWindow.getByLabel(label);
    if (!window) {
      ready.cancel();
      console.error(`ensureAppWindow: no webview with label "${label}"`);
      return null;
    }
    if (result.created) {
      await ready.promise;
    } else {
      ready.cancel();
    }
    return window;
  } catch (err) {
    ready.cancel();
    console.error(`ensureAppWindow(${label})`, err);
    return null;
  }
}

/** Hide a preloaded window, or destroy one that is created on demand. */
export async function releaseAppWindow(label: string): Promise<void> {
  try {
    await invoke("release_app_window", { label });
  } catch (err) {
    console.error(`releaseAppWindow(${label})`, err);
  }
}

/** Boot the resident Skin and Studio webviews after the library window is up. */
export async function warmResidentWindows(): Promise<void> {
  await invoke("warm_resident_windows");
}

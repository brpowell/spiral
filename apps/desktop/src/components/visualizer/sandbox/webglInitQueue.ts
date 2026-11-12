import { getDesktopPlatform } from "@/lib/windows/windowChrome";

/**
 * WebKitGTK aborts the whole web process when two worker threads create WebGL
 * contexts at the same moment (ANGLE throws while `EGL_CreateContext` runs on
 * both). Several visualizer workers start together whenever a grid of
 * previews renders, so on Linux their WebGL setup takes turns. WebKit on macOS
 * is not affected, and there WebGL workers keep starting in parallel.
 */
export function webglInitNeedsQueue(): boolean {
  return getDesktopPlatform() === "linux";
}

let tail: Promise<void> = Promise.resolve();

/**
 * Run `init` once every earlier queued init has settled. A failed init still
 * frees the queue for the next one.
 */
export function queueWebglInit<T>(init: () => Promise<T>): Promise<T> {
  const result = tail.then(init);
  tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

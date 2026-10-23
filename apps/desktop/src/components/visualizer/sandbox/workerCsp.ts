/**
 * Content-Security-Policy for the visualizer draw-module worker.
 *
 * A dedicated worker loaded from a URL takes its policy from the worker
 * script's own response, not from the page. Tauri only attaches CSP to HTML
 * assets, so the worker script is served with this header separately:
 * `src-tauri/src/viz_worker_csp.rs` in packaged builds and the dev-server
 * plugin in `vite.config.ts` under `tauri dev`. Keep the Rust copy identical
 * (a unit test checks).
 *
 * Only same-origin scripts (the worker bundle) and the host's one blob: entry
 * module may load. No eval, no network, no `asset:` reads, no nested workers.
 */
export const VIZ_WORKER_CSP = "default-src 'none'; script-src 'self' blob:";

/** Probe module URL. A data: URL is outside `script-src`, so CSP must refuse it. */
const CSP_PROBE_MODULE = "data:text/javascript,export default 0";

/**
 * Fail closed if the worker is running without {@link VIZ_WORKER_CSP}, e.g. a
 * window that does not attach the header or a webview that ignores it. Call
 * before the global lockdown, while `eval` is still reachable to probe with.
 */
export async function assertWorkerCspEnforced(
  scope: { eval: (code: string) => unknown } = globalThis,
  importModule: (url: string) => Promise<unknown> = (url) =>
    import(/* @vite-ignore */ url),
): Promise<void> {
  let evalAllowed = true;
  try {
    scope.eval("0");
  } catch {
    evalAllowed = false;
  }
  let dataImportAllowed = true;
  try {
    await importModule(CSP_PROBE_MODULE);
  } catch {
    dataImportAllowed = false;
  }
  if (evalAllowed || dataImportAllowed) {
    throw new Error(
      "[viz-sandbox] worker Content-Security-Policy is not in effect",
    );
  }
}

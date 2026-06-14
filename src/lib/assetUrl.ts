import { convertFileSrc, invoke } from "@tauri-apps/api/core";

/** Synchronous asset URL from a local path (no cache-bust IPC). */
export function assetUrlFromPath(path: string): string {
  return convertFileSrc(path);
}

/** Resolve a local file path to a cache-busted asset URL for display in the WebView. */
export async function toAssetUrl(path: string): Promise<string> {
  const base = convertFileSrc(path);
  try {
    const modifiedMs = await invoke<number>("get_file_modified_ms", { path });
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}v=${modifiedMs}`;
  } catch {
    return base;
  }
}

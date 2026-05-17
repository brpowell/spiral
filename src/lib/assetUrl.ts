import { convertFileSrc, invoke } from "@tauri-apps/api/core";

/** Cache-bust local asset URLs so replaced files on disk are not served from the WebView cache. */
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

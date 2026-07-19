import { convertFileSrc } from "@tauri-apps/api/core";

/** Resolve a pack.json `icon` path (relative to pack root) to a WebView asset URL. */
export function packIconUrl(packDir: string, icon: string): string {
  const relative = icon.replace(/^\/+/, "");
  return convertFileSrc(`${packDir}/${relative}`);
}

import { convertFileSrc } from "@tauri-apps/api/core";

/** Resolve a pack.json `preview` path (relative to pack root) to a WebView asset URL. */
export function packPreviewUrl(packDir: string, preview: string): string {
  const relative = preview.replace(/^\/+/, "");
  return convertFileSrc(`${packDir}/${relative}`);
}

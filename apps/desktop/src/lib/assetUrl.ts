import { convertFileSrc, invoke } from "@tauri-apps/api/core";

/** Readable file path for error messages and UI (decodes Tauri asset URLs). */
export function formatAssetForDisplay(urlOrPath: string): string {
  if (urlOrPath.startsWith("asset://")) {
    const withoutScheme = urlOrPath.slice("asset://".length);
    const slash = withoutScheme.indexOf("/");
    if (slash !== -1) {
      const [encodedPath] = withoutScheme.slice(slash + 1).split("?");
      try {
        const decoded = decodeURIComponent(encodedPath);
        return decoded.startsWith("/") ? decoded : `/${decoded}`;
      } catch {
        // fall through
      }
    }
  }

  if (urlOrPath.includes("asset.localhost")) {
    try {
      const { pathname } = new URL(urlOrPath);
      return decodeURIComponent(pathname);
    } catch {
      // fall through
    }
  }

  return urlOrPath;
}

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

import { homeDir } from "@tauri-apps/api/path";
import { useCallback, useEffect, useState } from "react";

/**
 * `/Users/me/Music` → `~/Music` when `path` is inside `home`. Only for
 * `/`-style homes (macOS, Linux): Windows has no `~` convention, so its paths
 * stay as they are.
 */
export function shortenHomePath(path: string, home: string | null): string {
  if (!home || home.includes("\\")) return path;
  const root = home.replace(/\/+$/, "");
  if (!root) return path;
  if (path === root) return "~";
  return path.startsWith(`${root}/`) ? `~${path.slice(root.length)}` : path;
}

let homePromise: Promise<string | null> | null = null;

function loadHome(): Promise<string | null> {
  homePromise ??= homeDir().catch(() => null);
  return homePromise;
}

/** The user's home folder, or null until it loads (or if it can't be read). */
export function useHomeDir(): string | null {
  const [home, setHome] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void loadHome().then((dir) => {
      if (live) setHome(dir);
    });
    return () => {
      live = false;
    };
  }, []);
  return home;
}

/**
 * For showing paths: a function that writes the home folder as `~`. Paths
 * show in full until the home folder loads. Keep the real path for anything
 * that's acted on or copied into a command.
 */
export function useShortenHomePath(): (path: string) => string {
  const home = useHomeDir();
  return useCallback((path: string) => shortenHomePath(path, home), [home]);
}

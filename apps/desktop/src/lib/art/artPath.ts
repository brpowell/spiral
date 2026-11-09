import { invoke } from "@tauri-apps/api/core";

export async function fileExists(path: string): Promise<boolean> {
  return invoke<boolean>("file_exists", { path });
}

/** Return the path when the file still exists; otherwise null. */
export async function resolveArtPathIfExists(
  artPath: string | null | undefined,
): Promise<string | null> {
  if (!artPath) return null;
  return (await fileExists(artPath)) ? artPath : null;
}

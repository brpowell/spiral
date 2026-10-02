import { resolveIcon } from "./iconLibrary";
import type { IconComponent } from "./iconLibrary";

/** True when `icon` is a pack-relative raster asset under assets/. */
export function isSkinAssetIconPath(icon: string): boolean {
  return /\.(png|gif|webp|jpe?g)$/i.test(icon);
}

/**
 * Resolve a skin library icon id to a registry component.
 * Id matches the icon library (`setList`, `headphones`); pack rasters return undefined.
 */
export function resolveSkinLibraryIcon(id: string): IconComponent | undefined {
  if (!id || isSkinAssetIconPath(id)) return undefined;
  return resolveIcon(id);
}

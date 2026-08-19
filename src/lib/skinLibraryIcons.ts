import type { ComponentType, SVGProps } from "react";
import * as Icons from "../components/icons";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const ICON_MODULE = Icons as Record<string, IconComponent | undefined>;

/** True when `icon` is a pack-relative raster asset under assets/. */
export function isSkinAssetIconPath(icon: string): boolean {
  return /\.(png|gif|webp|jpe?g)$/i.test(icon);
}

/**
 * Resolve a skin library icon id to an `icons.tsx` component.
 * Id is the `Icon*` export with the prefix stripped (`setList` → `IconSetList`).
 */
export function resolveSkinLibraryIcon(id: string): IconComponent | undefined {
  if (!id || isSkinAssetIconPath(id)) return undefined;
  const exportName = `Icon${id[0]!.toUpperCase()}${id.slice(1)}`;
  return ICON_MODULE[exportName];
}

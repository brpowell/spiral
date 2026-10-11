import type { LoadedSkinPack } from "../types/skin";
import { validateSkinManifestLayouts } from "./skinLayout";

/**
 * Run layout-tree validation after a pack load.
 * Structural errors are logged; load is not blocked.
 */
export function reportSkinLayoutValidation(pack: LoadedSkinPack): void {
  const result = validateSkinManifestLayouts(pack.manifest.views);
  const label = pack.summary.id || pack.manifest.id;

  for (const issue of result.errors) {
    console.error(
      `[skinLayout] ${label}: ${issue.code} at ${issue.path} — ${issue.message}`,
    );
  }
}

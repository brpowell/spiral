export const SKIN_AUX_LABEL_PREFIX = "skin-aux-";

export interface SkinAuxContext {
  skinId: string;
  viewId: string;
}

/**
 * Tauri webview labels allow only `a-zA-Z0-9-/:_`. Pack contribution ids use
 * `authorId.packId.type.contributionId` (e.g. `spiral.xbox.skin.xbox`), so map `.` ↔ `:` for window labels.
 */
function encodeSkinIdForLabel(skinId: string): string {
  return skinId.replace(/\./g, ":");
}

function decodeSkinIdFromLabel(encoded: string): string {
  return encoded.replace(/:/g, ".");
}

export function skinAuxWindowLabel(skinId: string, viewId: string): string {
  return `${SKIN_AUX_LABEL_PREFIX}${encodeSkinIdForLabel(skinId)}_${viewId}`;
}

export function parseSkinAuxWindowLabel(label: string): SkinAuxContext | null {
  if (!label.startsWith(SKIN_AUX_LABEL_PREFIX)) return null;
  const rest = label.slice(SKIN_AUX_LABEL_PREFIX.length);
  const separator = rest.lastIndexOf("_");
  if (separator <= 0) return null;
  const skinId = decodeSkinIdFromLabel(rest.slice(0, separator));
  const viewId = rest.slice(separator + 1);
  if (!skinId || !viewId) return null;
  return { skinId, viewId };
}

export function parseSkinAuxContextFromUrl(): SkinAuxContext | null {
  const params = new URLSearchParams(window.location.search);
  if (params.get("skinAux") !== "1") return null;
  const skinId = params.get("skinId");
  const viewId = params.get("viewId");
  if (!skinId || !viewId) return null;
  return { skinId, viewId };
}

export function buildSkinAuxWindowUrl(skinId: string, viewId: string): string {
  const params = new URLSearchParams({
    skinAux: "1",
    skinId,
    viewId,
  });
  if (import.meta.env.DEV) {
    return `http://localhost:1420/?${params.toString()}`;
  }
  return `/?${params.toString()}`;
}

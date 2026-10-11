import type { DragInference, LoadedSkinPack, SkinView } from "../types/skin";
import { resolveViewWindowChrome } from "./skinModeWindowChrome";

/** Home view: the sole view, or the one marked `presentation: "primary"`. */
export function primaryViewId(
  views: Record<string, SkinView>,
): string | undefined {
  const ids = Object.keys(views);
  if (ids.length === 1) return ids[0];
  return ids.find((id) => views[id]?.presentation === "primary");
}

export function isPrimaryView(pack: LoadedSkinPack, viewId: string): boolean {
  return primaryViewId(pack.manifest.views) === viewId;
}

export function isExclusiveView(pack: LoadedSkinPack, viewId: string): boolean {
  return pack.manifest.views[viewId]?.presentation === "exclusive";
}

export function isAuxiliaryView(pack: LoadedSkinPack, viewId: string): boolean {
  return pack.manifest.views[viewId]?.presentation === "auxiliary";
}

export function canSwitchView(pack: LoadedSkinPack, viewId: string): boolean {
  return isPrimaryView(pack, viewId) || isExclusiveView(pack, viewId);
}

export function listSwitchableViewIds(pack: LoadedSkinPack): string[] {
  return Object.keys(pack.manifest.views).filter((viewId) =>
    canSwitchView(pack, viewId),
  );
}

export function viewWindowSizeChanged(
  pack: LoadedSkinPack,
  fromViewId: string,
  toViewId: string,
): boolean {
  const { grows, shrinks } = compareViewWindowResize(
    pack,
    fromViewId,
    toViewId,
  );
  return grows || shrinks;
}

export function viewWindowGrows(
  pack: LoadedSkinPack,
  fromViewId: string,
  toViewId: string,
): boolean {
  return compareViewWindowResize(pack, fromViewId, toViewId).grows;
}

function compareViewWindowResize(
  pack: LoadedSkinPack,
  fromViewId: string,
  toViewId: string,
): { grows: boolean; shrinks: boolean } {
  const from = resolveViewWindowChrome(pack, fromViewId);
  const to = resolveViewWindowChrome(pack, toViewId);
  return {
    grows:
      to.defaultWidth > from.defaultWidth ||
      to.defaultHeight > from.defaultHeight,
    shrinks:
      to.defaultWidth < from.defaultWidth ||
      to.defaultHeight < from.defaultHeight,
  };
}

export function resolveViewDragInference(view: SkinView): DragInference {
  if (view.dragInference) return view.dragInference;
  return view.layout.type === "canvas" ? "auto" : "manual";
}

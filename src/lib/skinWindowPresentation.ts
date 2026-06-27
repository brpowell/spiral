import type {
  DragInference,
  LoadedSkinPack,
  SkinView,
  SkinViewPresentation,
} from "../types/skin";
import { resolveViewWindowChrome } from "./skinModeWindowChrome";

export function isPrimaryView(pack: LoadedSkinPack, viewId: string): boolean {
  const view = pack.manifest.views[viewId];
  if (!view) return false;
  if (view.presentation === "auxiliary" || view.presentation === "exclusive") {
    return false;
  }
  if (view.presentation === "primary") return true;
  return viewId === pack.manifest.defaultView;
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
  const { grows, shrinks } = compareViewWindowResize(pack, fromViewId, toViewId);
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

export function resolveViewPresentation(
  view: SkinView,
  viewId: string,
  defaultViewId: string,
): SkinViewPresentation {
  if (view.presentation) return view.presentation;
  return viewId === defaultViewId ? "primary" : "exclusive";
}

export function resolveViewLayoutMode(view: SkinView): "slots" | "canvas" {
  return view.layoutMode === "canvas" ? "canvas" : "slots";
}

export function resolveViewDragInference(
  view: SkinView,
): DragInference {
  if (view.dragInference) return view.dragInference;
  return resolveViewLayoutMode(view) === "canvas" ? "auto" : "manual";
}

import type {
  LayoutBounds,
  LayoutNode,
  SkinCanvasSpec,
  SkinPanel,
  SkinView,
  StretchLayoutBounds,
} from "../types/skin";
import {
  evaluateViewBind,
  type ViewStateValues,
} from "./skinViewStateContext";

export type PanelOpenState = Record<string, boolean>;

export interface PanelBindContext {
  panelOpen: PanelOpenState;
  panelRevealed?: PanelOpenState;
  panelSettled?: PanelOpenState;
  viewState?: ViewStateValues;
}

const PANEL_BIND_RE =
  /^skin\.panel\.([^.]+)\.(open|closed|revealed|settled|openSettled)$/;

export function parsePanelBindPath(
  path: string,
): {
  panelId: string;
  prop: "open" | "closed" | "revealed" | "settled" | "openSettled";
} | null {
  const match = path.match(PANEL_BIND_RE);
  if (!match) return null;
  const [, panelId, prop] = match;
  return {
    panelId,
    prop: prop as "open" | "closed" | "revealed" | "settled" | "openSettled",
  };
}

export function evaluatePanelBind(
  path: string,
  panelOpen: PanelOpenState,
  panelRevealed: PanelOpenState = {},
  panelSettled: PanelOpenState = {},
): boolean | null {
  const parsed = parsePanelBindPath(path);
  if (!parsed) return null;
  if (parsed.prop === "revealed") {
    return panelRevealed[parsed.panelId] ?? false;
  }
  if (parsed.prop === "settled") {
    return panelSettled[parsed.panelId] ?? true;
  }
  if (parsed.prop === "openSettled") {
    return (
      (panelOpen[parsed.panelId] ?? false) &&
      (panelSettled[parsed.panelId] ?? true)
    );
  }
  const isOpen = panelOpen[parsed.panelId] ?? false;
  return parsed.prop === "open" ? isOpen : !isOpen;
}

export function defaultPanelRevealedState(
  view: SkinView,
  panelOpen: PanelOpenState = defaultPanelOpenState(view),
): PanelOpenState {
  const state: PanelOpenState = {};
  if (!view.panels) return state;
  for (const [id] of Object.entries(view.panels)) {
    state[id] = panelOpen[id] ?? false;
  }
  return state;
}

/** True when a panel is not mid-slide (controls can appear without crossing the head). */
export function defaultPanelSettledState(view: SkinView): PanelOpenState {
  const state: PanelOpenState = {};
  if (!view.panels) return state;
  for (const id of Object.keys(view.panels)) {
    state[id] = true;
  }
  return state;
}

export function defaultPanelOpenState(view: SkinView): PanelOpenState {
  const state: PanelOpenState = {};
  if (!view.panels) return state;
  for (const [id, panel] of Object.entries(view.panels)) {
    state[id] = panel.defaultOpen ?? false;
  }
  return state;
}

function conditionMatches(
  condition: string,
  ctx: PanelBindContext,
): boolean {
  const panelValue = evaluatePanelBind(
    condition,
    ctx.panelOpen,
    ctx.panelRevealed,
    ctx.panelSettled,
  );
  if (panelValue !== null) return panelValue;
  if (ctx.viewState) {
    const viewValue = evaluateViewBind(condition, ctx.viewState);
    if (viewValue !== null) return Boolean(viewValue);
  }
  return false;
}

function resolveDimensionWhen(
  base: number,
  when: Record<string, number> | undefined,
  ctx: PanelBindContext,
): number {
  if (!when) return base;
  let resolved = base;
  for (const [condition, value] of Object.entries(when)) {
    if (conditionMatches(condition, ctx)) {
      resolved = Math.max(resolved, value);
    }
  }
  return resolved;
}

export function resolveCanvasSize(
  view: SkinView,
  _panelOpen: PanelOpenState = {},
): { width: number; height: number } {
  const canvas: SkinCanvasSpec | undefined = view.canvas;
  const width =
    canvas?.width ?? view.window?.defaultWidth ?? 320;
  const height =
    canvas?.height ?? view.window?.defaultHeight ?? 440;

  return { width, height };
}

/** Native window size for panel-driven chrome (may be smaller than the canvas stage). */
export function resolvePanelWindowSize(
  view: SkinView,
  panelOpen: PanelOpenState = {},
  panelRevealed: PanelOpenState = {},
  panelSettled: PanelOpenState = {},
): { width: number; height: number } {
  const ctx: PanelBindContext = { panelOpen, panelRevealed, panelSettled };
  const canvas = resolveCanvasSize(view, panelOpen);
  let width = view.window?.defaultWidth ?? canvas.width;
  let height = view.window?.defaultHeight ?? canvas.height;

  width = resolveDimensionWhen(width, view.canvas?.widthWhen, ctx);
  height = resolveDimensionWhen(height, view.canvas?.heightWhen, ctx);

  if (view.panels) {
    for (const [id, panel] of Object.entries(view.panels)) {
      if (!panelOpen[id]) continue;
      if (panel.windowWhenOpen?.width !== undefined) {
        width = Math.max(width, panel.windowWhenOpen.width);
      }
      if (panel.windowWhenOpen?.height !== undefined) {
        height = Math.max(height, panel.windowWhenOpen.height);
      }
    }
  }

  return { width, height };
}

/** Resolve WMP stretch/fixed bounds against the canvas stage size. */
export function resolveStretchBounds(
  bounds: StretchLayoutBounds,
  stageW: number,
  stageH: number,
): { x: number; y: number; w: number; h: number; zIndex?: number } {
  let y: number;
  if (bounds.y !== undefined) {
    y = bounds.y;
  } else if (bounds.bottom !== undefined) {
    y = stageH - bounds.bottom;
  } else {
    y = 0;
  }

  let h: number;
  if (bounds.h !== undefined) {
    h = bounds.h;
  } else if (bounds.bottom !== undefined) {
    h = Math.max(0, stageH - y - bounds.bottom);
  } else {
    h = 0;
  }

  let x: number;
  let w: number;

  if (bounds.x !== undefined) {
    x = bounds.x;
    if (bounds.right !== undefined && bounds.w === undefined) {
      w = Math.max(0, stageW - bounds.x - bounds.right);
    } else {
      w = bounds.w ?? 0;
    }
  } else if (bounds.right !== undefined) {
    x = stageW - bounds.right;
    w = bounds.w ?? 0;
  } else {
    x = 0;
    w = bounds.w ?? 0;
  }

  return { x, y, w, h, zIndex: bounds.zIndex };
}

export function resolveNodeBounds(
  bounds: LayoutBounds | undefined,
  boundsWhen: Record<string, Partial<LayoutBounds>> | undefined,
  ctx: PanelBindContext,
): LayoutBounds | undefined {
  if (!bounds) return undefined;
  let resolved: LayoutBounds = { ...bounds };
  if (boundsWhen) {
    for (const [condition, override] of Object.entries(boundsWhen)) {
      if (conditionMatches(condition, ctx)) {
        resolved = { ...resolved, ...override };
      }
    }
  }
  return resolved;
}

export function getNodeBoundsWhen(
  node: LayoutNode,
): Record<string, Partial<LayoutBounds>> | undefined {
  if ("boundsWhen" in node) {
    return node.boundsWhen;
  }
  return undefined;
}

export function panelIdsForView(view: SkinView | undefined): string[] {
  if (!view?.panels) return [];
  return Object.keys(view.panels);
}

export function panelDefinition(
  view: SkinView | undefined,
  panelId: string,
): SkinPanel | undefined {
  return view?.panels?.[panelId];
}

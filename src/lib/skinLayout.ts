/**
 * Shared skin layout tree utilities: walks, coordinate conversion, z-order,
 * and structural validation. Consumed by runtime tooling and WMS port work.
 *
 * Coordinate rules (see skin-contract.md):
 * - View stage root (`layoutMode: "canvas"`) is `canvas`; children are stage-absolute.
 * - Nested bounded groups are `subview` with parent-relative `bounds`.
 * - `bounds.right` / stretch resolve against the **current** layout context size.
 */

import type {
  LayoutBounds,
  LayoutNode,
  SkinView,
} from "../types/skin";

export interface SkinLayoutSize {
  width: number;
  height: number;
}

export interface SkinLayoutOrigin {
  x: number;
  y: number;
}

/** Explicit layout context stack entry (stage / parent group / tiledFrame content). */
export interface SkinLayoutContext {
  origin: SkinLayoutOrigin;
  size: SkinLayoutSize;
  space: "stage" | "parent" | "content";
}

export interface AbsoluteBounds {
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex?: number;
}

export interface LayoutWalkEntry {
  node: LayoutNode;
  /** Ancestors from root down to the immediate parent (empty for the root). */
  ancestors: LayoutNode[];
  depth: number;
}

export type SkinLayoutValidationSeverity = "error" | "warning";

export interface SkinLayoutValidationIssue {
  severity: SkinLayoutValidationSeverity;
  code:
    | "duplicate-id"
    | "missing-bounds"
    | "missing-id"
    | "nested-canvas"
    | "subview-as-root";
  message: string;
  nodeId?: string;
  path: string;
}

export interface ValidateLayoutTreeResult {
  ok: boolean;
  errors: SkinLayoutValidationIssue[];
  warnings: SkinLayoutValidationIssue[];
}

export interface FlattenedLayoutNode {
  node: LayoutNode;
  absoluteBounds: AbsoluteBounds | undefined;
  path: string;
}

function nodeLabel(node: LayoutNode): string {
  return node.id ?? node.type;
}

function nodePath(ancestors: LayoutNode[], node: LayoutNode): string {
  return [...ancestors.map(nodeLabel), nodeLabel(node)].join("/");
}

/** Direct children of container nodes (undefined for leaves). */
export function getLayoutChildren(node: LayoutNode): LayoutNode[] | undefined {
  if ("children" in node && Array.isArray(node.children)) {
    return node.children;
  }
  return undefined;
}

/**
 * Depth-first walk of a layout tree with parent chain.
 * Yields the root first, then descendants.
 */
export function* walkLayoutTree(root: LayoutNode): Generator<LayoutWalkEntry> {
  function* visit(
    node: LayoutNode,
    ancestors: LayoutNode[],
  ): Generator<LayoutWalkEntry> {
    yield { node, ancestors, depth: ancestors.length };
    const children = getLayoutChildren(node);
    if (!children) return;
    const nextAncestors = [...ancestors, node];
    for (const child of children) {
      yield* visit(child, nextAncestors);
    }
  }
  yield* visit(root, []);
}

/** Resolve local `bounds` against a containing block size (parent or stage). */
export function resolveLocalBounds(
  bounds: LayoutBounds,
  contextSize: SkinLayoutSize,
): AbsoluteBounds {
  let x: number;
  if (bounds.x !== undefined) {
    x = bounds.x;
  } else if (bounds.right !== undefined) {
    // `right` = inset of the node's left edge from the context's right edge.
    x = contextSize.width - bounds.right;
  } else {
    x = 0;
  }
  return {
    x,
    y: bounds.y,
    w: bounds.w,
    h: bounds.h,
    zIndex: bounds.zIndex,
  };
}

/**
 * Build the layout context stack for a node given its ancestors and stage size.
 * Nested bounded groups push `parent` spaces; root contributes `stage`.
 */
export function layoutContextStack(
  ancestors: LayoutNode[],
  stageSize: SkinLayoutSize,
): SkinLayoutContext[] {
  const stack: SkinLayoutContext[] = [
    {
      origin: { x: 0, y: 0 },
      size: stageSize,
      space: "stage",
    },
  ];

  for (const ancestor of ancestors) {
    const parentCtx = stack[stack.length - 1]!;
    if (!ancestor.bounds) {
      // Unbounded container (e.g. root canvas): children stay in current space.
      continue;
    }
    const local = resolveLocalBounds(ancestor.bounds, parentCtx.size);
    stack.push({
      origin: {
        x: parentCtx.origin.x + local.x,
        y: parentCtx.origin.y + local.y,
      },
      size: { width: local.w, height: local.h },
      space: "parent",
    });
  }

  return stack;
}

/**
 * Parent-relative (or stage-relative) bounds → stage-absolute.
 * `ancestors` is the chain from the view layout root to the node's parent.
 */
export function resolveAbsoluteBounds(
  node: LayoutNode,
  ancestors: LayoutNode[],
  stageSize: SkinLayoutSize,
): AbsoluteBounds | undefined {
  if (!node.bounds) return undefined;
  const stack = layoutContextStack(ancestors, stageSize);
  const ctx = stack[stack.length - 1]!;
  const local = resolveLocalBounds(node.bounds, ctx.size);
  return {
    x: ctx.origin.x + local.x,
    y: ctx.origin.y + local.y,
    w: local.w,
    h: local.h,
    zIndex: local.zIndex,
  };
}

/**
 * Stage-absolute bounds → parent-relative by subtracting the parent origin.
 * Does not convert `right`-anchored forms; works on resolved `{ x, y, w, h }`.
 */
export function localizeBounds(
  absolute: AbsoluteBounds,
  parentOrigin: SkinLayoutOrigin,
): AbsoluteBounds {
  return {
    x: absolute.x - parentOrigin.x,
    y: absolute.y - parentOrigin.y,
    w: absolute.w,
    h: absolute.h,
    zIndex: absolute.zIndex,
  };
}

/** Sort container children by `bounds.zIndex` ascending (missing → 0). */
export function sortChildrenByZIndex(container: LayoutNode): LayoutNode[] {
  const children = getLayoutChildren(container);
  if (!children) return [];
  return children
    .slice()
    .sort((a, b) => (a.bounds?.zIndex ?? 0) - (b.bounds?.zIndex ?? 0));
}

function isNestedCanvasGroup(
  node: LayoutNode,
  ancestors: LayoutNode[],
): boolean {
  return node.type === "canvas" && ancestors.length > 0;
}

/**
 * Structural layout lint for a view.
 * Nested groups must be `subview`; nested `canvas` is rejected.
 */
export function validateLayoutTree(view: SkinView): ValidateLayoutTreeResult {
  const errors: SkinLayoutValidationIssue[] = [];
  const warnings: SkinLayoutValidationIssue[] = [];
  const seenIds = new Map<string, string>();

  const root = view.layout;

  if (root.type === "subview") {
    errors.push({
      severity: "error",
      code: "subview-as-root",
      message: "subview cannot be a view layout root; use canvas (or tiledFrame)",
      path: root.id ?? "subview",
      nodeId: root.id,
    });
  }

  for (const { node, ancestors } of walkLayoutTree(root)) {
    const path = nodePath(ancestors, node);

    if (node.id) {
      const prior = seenIds.get(node.id);
      if (prior !== undefined) {
        errors.push({
          severity: "error",
          code: "duplicate-id",
          message: `duplicate layout node id "${node.id}" (also at ${prior})`,
          nodeId: node.id,
          path,
        });
      } else {
        seenIds.set(node.id, path);
      }
    } else if (ancestors.length > 0) {
      // Skip warning on anonymous root containers (common for stage canvas).
      warnings.push({
        severity: "warning",
        code: "missing-id",
        message: `layout node type "${node.type}" should have a unique id`,
        path,
      });
    }

    if (isNestedCanvasGroup(node, ancestors)) {
      errors.push({
        severity: "error",
        code: "nested-canvas",
        message:
          "nested canvas is invalid; use subview (canvas is view stage root only)",
        nodeId: node.id,
        path,
      });
    }

    if (node.type === "subview" && !node.bounds) {
      errors.push({
        severity: "error",
        code: "missing-bounds",
        message: "subview requires bounds",
        nodeId: node.id,
        path,
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Optional export: nested tree → list of nodes with stage-absolute bounds.
 * Useful for diffing against flat hand ports.
 */
export function flattenLayout(
  view: SkinView,
  stageSize: SkinLayoutSize,
): FlattenedLayoutNode[] {
  const out: FlattenedLayoutNode[] = [];
  for (const { node, ancestors } of walkLayoutTree(view.layout)) {
    out.push({
      node,
      absoluteBounds: resolveAbsoluteBounds(node, ancestors, stageSize),
      path: nodePath(ancestors, node),
    });
  }
  return out;
}

/** Validate every view in a manifest; aggregate issues. */
export function validateSkinManifestLayouts(
  views: Record<string, SkinView>,
): ValidateLayoutTreeResult {
  const errors: SkinLayoutValidationIssue[] = [];
  const warnings: SkinLayoutValidationIssue[] = [];
  for (const [viewId, view] of Object.entries(views)) {
    const result = validateLayoutTree(view);
    for (const issue of result.errors) {
      errors.push({ ...issue, path: `${viewId}/${issue.path}` });
    }
    for (const issue of result.warnings) {
      warnings.push({ ...issue, path: `${viewId}/${issue.path}` });
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

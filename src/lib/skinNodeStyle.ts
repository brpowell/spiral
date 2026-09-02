import type { CSSProperties } from "react";
import { evaluateSkinCondition, useSkinBindState } from "./skinBinds";
import { iterWhenOverlays } from "./skinWhenOverlays";
import type { NodeStyle, SkinCondition, WhenMapOrList } from "../types/skin";

/** Shallow-merge `styleWhen` overlays onto `style` (last match wins). */
export function resolveNodeStyle(
  style: NodeStyle | undefined,
  styleWhen: WhenMapOrList<NodeStyle> | undefined,
  isConditionTrue: (condition: SkinCondition) => boolean,
): NodeStyle | undefined {
  let resolved = style;
  for (const { when, overlay } of iterWhenOverlays(styleWhen)) {
    if (isConditionTrue(when)) {
      resolved = { ...resolved, ...overlay };
    }
  }
  if (!resolved || Object.keys(resolved).length === 0) return undefined;
  return resolved;
}

export function useResolvedNodeStyle(
  style: NodeStyle | undefined,
  styleWhen: WhenMapOrList<NodeStyle> | undefined,
): NodeStyle | undefined {
  const bindState = useSkinBindState();
  return resolveNodeStyle(style, styleWhen, (condition) =>
    evaluateSkinCondition(condition, bindState),
  );
}

/** Emit declared node `style` as inline CSS. Omitted fields are left to CSS. */
export function styleFromSkinNode(
  style: NodeStyle | undefined,
  options?: { omitOpacity?: boolean },
): CSSProperties | undefined {
  if (!style) return undefined;

  const css: CSSProperties = {};
  if (style.color !== undefined) css.color = style.color;
  if (style.fontSize !== undefined) css.fontSize = `${style.fontSize}px`;
  if (style.fontWeight !== undefined) css.fontWeight = style.fontWeight;
  if (style.textAlign !== undefined) css.textAlign = style.textAlign;
  if (style.backgroundColor !== undefined) {
    css.backgroundColor = style.backgroundColor;
  }
  if (style.opacity !== undefined && !options?.omitOpacity) {
    css.opacity = style.opacity;
  }

  return Object.keys(css).length === 0 ? undefined : css;
}

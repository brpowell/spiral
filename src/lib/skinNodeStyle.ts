import type { CSSProperties } from "react";
import type { NodeStyle } from "../types/skin";

/** Emit declared node `style` as inline CSS. Omitted fields are left to CSS. */
export function styleFromSkinNode(
  style: NodeStyle | undefined,
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

  return Object.keys(css).length === 0 ? undefined : css;
}

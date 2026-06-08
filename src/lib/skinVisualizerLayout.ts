import type { CSSProperties } from "react";
import type { SkinManifest, SkinVisualizer, SkinVisualizerSize } from "../types/skin";

export type VisualizerPlacement = "top" | "bottom";
export type VisualizerDisplay = "mini" | "panel";

export interface ResolvedVisualizerLayout {
  placement: VisualizerPlacement;
  display: VisualizerDisplay;
  shellClassName: string;
  slotStyle: CSSProperties;
  slotClassName: string;
  variant: "mini" | "dock";
  showExpandToggle: boolean;
  fillContainer: boolean;
}

function sizeToCss(
  value: SkinVisualizerSize["width"] | SkinVisualizerSize["height"] | undefined,
  axis: "width" | "height",
): string | undefined {
  if (value === undefined) return undefined;
  if (value === "fill") return "100%";
  if (value === "flex") return axis === "height" ? undefined : "100%";
  return `${value}px`;
}

export function resolveVisualizerLayout(
  manifest: SkinManifest | undefined,
): ResolvedVisualizerLayout {
  const viz = manifest?.visualizer;
  const placement: VisualizerPlacement =
    viz?.placement === "top" ? "top" : "bottom";
  const display: VisualizerDisplay =
    viz?.display === "panel" ? "panel" : "mini";

  const size = viz?.size;
  const slotStyle: CSSProperties = {};
  const width = sizeToCss(size?.width, "width");
  const height =
    size?.height === "flex"
      ? undefined
      : sizeToCss(size?.height, "height");
  if (width) slotStyle.width = width;
  if (height) slotStyle.height = height;
  if (size?.minHeight !== undefined) slotStyle.minHeight = `${size.minHeight}px`;
  if (size?.maxHeight !== undefined) slotStyle.maxHeight = `${size.maxHeight}px`;

  const shellParts = [
    `skin-shell--viz-${placement}`,
    display === "panel" ? "skin-shell--viz-panel" : "",
    size?.height === "flex" ? "skin-shell--viz-flex" : "",
  ].filter(Boolean);

  const slotParts = [
    display === "panel" ? "visualizer-slot--panel" : "visualizer-slot--mini",
    size?.height === "flex" ? "visualizer-slot--flex" : "",
    size?.width === "fill" || display === "panel"
      ? "visualizer-slot--fill-width"
      : "",
  ].filter(Boolean);

  return {
    placement,
    display,
    shellClassName: shellParts.join(" "),
    slotStyle,
    slotClassName: slotParts.join(" "),
    variant: display === "panel" ? "dock" : "mini",
    showExpandToggle: display !== "panel",
    fillContainer: display === "panel",
  };
}

export function visualizerFromManifest(
  manifest: SkinManifest | undefined,
): SkinVisualizer | undefined {
  return manifest?.visualizer;
}

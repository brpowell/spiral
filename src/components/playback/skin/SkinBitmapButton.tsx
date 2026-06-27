import { useMemo } from "react";
import { skinAssetUrl } from "../../../lib/skinAssets";
import { useSkinAction } from "../../../lib/skinActions";
import { skinDragRegionNoneProps } from "../../../lib/skinDragRegion";
import {
  evaluateSkinBind,
  useSkinBindState,
  useSkinBindValue,
  useSkinDisabled,
} from "../../../lib/skinBinds";
import type { ButtonNode, LoadedSkinPack } from "../../../types/skin";
import "./SkinBitmapButton.css";

export function SkinBitmapButton({
  node,
  pack,
}: {
  node: ButtonNode;
  pack: LoadedSkinPack;
}) {
  const invoke = useSkinAction(node.action, node);
  const bindState = useSkinBindState();
  const isPlaying = useSkinBindValue("player.isPlaying");
  const hasTrack = useSkinBindValue("player.hasTrack");
  const canGoPrevious = useSkinBindValue("player.canGoPrevious");
  const canGoNext = useSkinBindValue("player.canGoNext");
  const disabledWhen = useSkinDisabled(node.disabledWhen);

  const presentation = node.presentation;
  if (presentation.kind !== "bitmap") return null;

  const assetBase = useMemo(() => {
    if (node.action === "player.togglePlayPause") {
      const base = presentation.assetBase;
      if (isPlaying) {
        if (base.endsWith("/play")) return `${base.slice(0, -5)}/pause`;
        if (base.endsWith("play")) return base.replace(/play$/, "pause");
      }
      return base;
    }
    return presentation.assetBase;
  }, [node.action, isPlaying, presentation.assetBase]);

  const width = presentation.width ?? 28;
  const height = presentation.height ?? 28;

  const hoverFormat = presentation.animatedHover ? "gif" : "png";
  const src = skinAssetUrl(pack.packDir, assetBase);
  const hoverSrc = skinAssetUrl(pack.packDir, assetBase, "hover", hoverFormat);
  const pressedSrc = skinAssetUrl(pack.packDir, assetBase, "pressed");

  const actionDisabled =
    disabledWhen ||
    (node.action === "player.previousTrack" && !canGoPrevious) ||
    (node.action === "player.nextTrack" && !canGoNext) ||
    (node.action === "player.togglePlayPause" && !hasTrack) ||
    (node.action === "player.play" && !hasTrack) ||
    (node.action === "player.pause" && !hasTrack);

  const isSticky =
    node.activeWhen &&
    Boolean(evaluateSkinBind(node.activeWhen, bindState));

  return (
    <button
      type="button"
      className={["skin-bitmap-btn", isSticky && "skin-bitmap-btn--sticky"]
        .filter(Boolean)
        .join(" ")}
      data-node-id={node.id}
      {...skinDragRegionNoneProps()}
      disabled={Boolean(actionDisabled)}
      aria-label={node.id ?? node.action}
      style={
        {
          "--skin-btn-w": `${width}px`,
          "--skin-btn-h": `${height}px`,
          "--skin-btn-img": `url("${src}")`,
          "--skin-btn-img-hover": `url("${hoverSrc}")`,
          "--skin-btn-img-pressed": `url("${pressedSrc}")`,
        } as React.CSSProperties
      }
      onClick={() => invoke(node.payload)}
    />
  );
}

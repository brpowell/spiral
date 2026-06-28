import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { skinAssetUrl } from "../../../lib/skinAssets";
import { useSkinAction } from "../../../lib/skinActions";
import { playSkinSound } from "../../../lib/skinSoundEffects";
import { skinDragRegionNoneProps } from "../../../lib/skinDragRegion";
import {
  evaluateSkinBind,
  useSkinBindState,
  useSkinBindValue,
  useSkinDisabled,
} from "../../../lib/skinBinds";
import {
  suppressSkinButtonHoverUntilPointerMove,
  useSkinButtonHoverSuppressed,
} from "../../../lib/skinButtonHoverSuppression";
import { useSkinTooltip } from "../../../lib/skinTooltips";
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
  const isMuted = useSkinBindValue("player.muted");
  const hasTrack = useSkinBindValue("player.hasTrack");
  const canGoPrevious = useSkinBindValue("player.canGoPrevious");
  const canGoNext = useSkinBindValue("player.canGoNext");
  const disabledWhen = useSkinDisabled(node.disabledWhen);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const hoverSuppressed = useSkinButtonHoverSuppressed();

  const presentation = node.presentation;
  const isBitmap = presentation.kind === "bitmap";

  const assetBase = useMemo(() => {
    if (!isBitmap) return "";
    if (node.action === "player.togglePlayPause") {
      const base = presentation.assetBase;
      if (isPlaying) {
        if (base.endsWith("/play")) return `${base.slice(0, -5)}/pause`;
        if (base.endsWith("play")) return base.replace(/play$/, "pause");
      }
      return base;
    }
    if (node.action === "player.toggleMute" && isMuted) {
      return `${presentation.assetBase}-muted`;
    }
    return presentation.assetBase;
  }, [isBitmap, node.action, isPlaying, isMuted, presentation]);

  const width = isBitmap ? (presentation.width ?? 28) : 28;
  const height = isBitmap ? (presentation.height ?? 28) : 28;

  const hoverFormat =
    !isBitmap
      ? "png"
      : node.action === "player.toggleMute" && isMuted
        ? "png"
        : presentation.animatedHover
          ? "gif"
          : "png";
  const src = isBitmap ? skinAssetUrl(pack.packDir, assetBase) : "";
  const hoverSrc = isBitmap
    ? skinAssetUrl(pack.packDir, assetBase, "hover", hoverFormat)
    : "";
  const pressedSrc =
    !isBitmap
      ? ""
      : node.action === "player.toggleMute"
        ? hoverSrc
        : skinAssetUrl(pack.packDir, assetBase, "pressed");

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

  const tooltip = useSkinTooltip({
    action: node.action,
    panelId: node.panelId,
    viewId: node.viewId,
    id: node.id,
    tooltip: node.tooltip,
    tooltipWhen: node.tooltipWhen,
  });

  useEffect(() => {
    if (hoverSuppressed) {
      setHovered(false);
      return;
    }
    if (btnRef.current?.matches(":hover")) {
      setHovered(true);
    }
  }, [hoverSuppressed]);

  const showHover = hovered && !hoverSuppressed && !pressed && !isSticky;
  const showPressed = pressed || Boolean(isSticky);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!isBitmap || actionDisabled || event.button !== 0) return;
    setPressed(true);
  };

  const onPointerUp = () => {
    setPressed(false);
    setHovered(false);
  };

  const onPointerEnter = () => {
    if (!hoverSuppressed) {
      setHovered(true);
    }
  };

  const onPointerLeave = () => {
    setHovered(false);
    setPressed(false);
  };

  if (!isBitmap) return null;

  return (
    <button
      ref={btnRef}
      type="button"
      className={[
        "skin-bitmap-btn",
        showHover && "skin-bitmap-btn--hover",
        showPressed && "skin-bitmap-btn--pressed",
      ]
        .filter(Boolean)
        .join(" ")}
      data-node-id={node.id}
      {...skinDragRegionNoneProps()}
      disabled={Boolean(actionDisabled)}
      aria-label={tooltip || node.id || node.action}
      title={tooltip || undefined}
      style={
        {
          "--skin-btn-w": `${width}px`,
          "--skin-btn-h": `${height}px`,
          "--skin-btn-img": `url("${src}")`,
          "--skin-btn-img-hover": `url("${hoverSrc}")`,
          "--skin-btn-img-pressed": `url("${pressedSrc}")`,
        } as React.CSSProperties
      }
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onClick={() => {
        playSkinSound(pack, node.sound);
        suppressSkinButtonHoverUntilPointerMove();
        invoke(node.payload);
      }}
    />
  );
}

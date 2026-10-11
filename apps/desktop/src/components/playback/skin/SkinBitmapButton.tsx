import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  interactiveAssetsUseGif,
  isSkinGifAsset,
  resolveInteractiveAssetFile,
  resolveInteractiveAssets,
  resolveInteractiveAssetUrl,
  skinAssetFileUrl,
} from "../../../lib/skinAssets";
import {
  playSkinSound,
  resolveSkinClickSound,
} from "../../../lib/skinSoundEffects";
import { skinDragRegionNoneProps } from "../../../lib/skinDragRegion";
import {
  evaluateSkinCondition,
  useSkinBindState,
  useSkinBindValue,
  useSkinControlEnabled,
} from "../../../lib/skinBinds";
import {
  suppressSkinButtonHoverUntilPointerMove,
  useSkinButtonHoverSuppressed,
} from "../../../lib/skinButtonHoverSuppression";
import { useSkinTooltip } from "../../../lib/skinTooltips";
import {
  primaryClickAction,
  primaryClickViewId,
  scheduleSkinEffects,
} from "../../../lib/skinEffects";
import type {
  ButtonNode,
  InteractiveAssetState,
  LoadedSkinPack,
} from "../../../types/skin";
import { SkinInteractiveAssetCanvas } from "./SkinInteractiveAssetCanvas";
import "./SkinBitmapButton.css";

export function SkinBitmapButton({
  node,
  pack,
}: {
  node: ButtonNode;
  pack: LoadedSkinPack;
}) {
  const bindState = useSkinBindState();
  const clickAction = primaryClickAction(node.onClick);
  const hasTrack = useSkinBindValue("player.hasTrack");
  const canGoPrevious = useSkinBindValue("player.canGoPrevious");
  const canGoNext = useSkinBindValue("player.canGoNext");
  const interactionEnabled = useSkinControlEnabled(node.enabledWhen);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const hoverSuppressed = useSkinButtonHoverSuppressed();
  // Hold pressed graphic until activeWhen bind catches up (same as SkinButtonGroup).
  const [settlingToggle, setSettlingToggle] = useState<{
    prevSticky: boolean;
  } | null>(null);
  const mountedRef = useRef(false);
  const prevVisualStateRef = useRef<InteractiveAssetState>("default");
  const [playKey, setPlayKey] = useState(0);
  const [animate, setAnimate] = useState(false);

  const presentation = node.presentation;
  const isBitmap = presentation.kind === "bitmap";

  const width = isBitmap ? (presentation.width ?? 28) : 28;
  const height = isBitmap ? (presentation.height ?? 28) : 28;

  const { assets, assetsWhen } = isBitmap
    ? presentation
    : { assets: { default: "" }, assetsWhen: undefined };

  const usesGif = isBitmap
    ? interactiveAssetsUseGif(assets, assetsWhen, bindState)
    : false;

  const resolvedAssets = isBitmap
    ? resolveInteractiveAssets(assets, assetsWhen, bindState)
    : null;
  const src = resolvedAssets
    ? skinAssetFileUrl(pack.packDir, resolvedAssets.default)
    : "";
  const hoverSrc = resolvedAssets
    ? skinAssetFileUrl(
        pack.packDir,
        resolvedAssets.hover ?? resolvedAssets.default,
      )
    : "";
  const pressedSrc = resolvedAssets
    ? skinAssetFileUrl(
        pack.packDir,
        resolvedAssets.pressed ?? resolvedAssets.default,
      )
    : "";
  const hasDisabledAsset = Boolean(resolvedAssets?.disabled);
  const disabledSrc = resolvedAssets?.disabled
    ? skinAssetFileUrl(pack.packDir, resolvedAssets.disabled)
    : "";

  const actionDisabled =
    !interactionEnabled ||
    (clickAction === "player.previousTrack" && !canGoPrevious) ||
    (clickAction === "player.nextTrack" && !canGoNext) ||
    (clickAction === "player.pause" && !hasTrack) ||
    (clickAction === "player.stop" && !hasTrack);

  const isSticky =
    node.activeWhen && evaluateSkinCondition(node.activeWhen, bindState);

  const tooltip = useSkinTooltip({
    action: clickAction,
    viewId: primaryClickViewId(node.onClick),
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

  useEffect(() => {
    if (!settlingToggle) return;
    if (Boolean(isSticky) !== settlingToggle.prevSticky) {
      setSettlingToggle(null);
      return;
    }
    const timeout = window.setTimeout(() => setSettlingToggle(null), 1000);
    return () => window.clearTimeout(timeout);
  }, [settlingToggle, isSticky]);

  const isSettling = settlingToggle !== null;
  const showHover =
    hovered && !hoverSuppressed && !pressed && !isSticky && !isSettling;
  const showPressed = pressed || Boolean(isSticky) || isSettling;

  const visualState: InteractiveAssetState = actionDisabled
    ? "disabled"
    : showPressed
      ? "pressed"
      : showHover
        ? "hover"
        : "default";

  const activeFile = resolveInteractiveAssetFile(
    assets,
    assetsWhen,
    bindState,
    visualState,
  );
  const activeUrl = resolveInteractiveAssetUrl(
    pack.packDir,
    assets,
    assetsWhen,
    bindState,
    visualState,
  );

  useEffect(() => {
    if (!usesGif) return;

    const prev = prevVisualStateRef.current;
    prevVisualStateRef.current = visualState;

    if (!mountedRef.current) {
      mountedRef.current = true;
      setAnimate(false);
      return;
    }

    if (visualState === "default") {
      const defaultFile = resolveInteractiveAssetFile(
        assets,
        assetsWhen,
        bindState,
        "default",
      );
      setAnimate(prev !== "default" && isSkinGifAsset(defaultFile));
    } else {
      setAnimate(true);
    }

    if (prev !== visualState) {
      setPlayKey((key) => key + 1);
    }
  }, [usesGif, visualState, assets, assetsWhen, bindState]);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!isBitmap || actionDisabled || event.button !== 0) return;
    setPressed(true);
  };

  const onPointerUp = () => {
    setHovered(false);
    if (!node.activeWhen) {
      setPressed(false);
    }
  };

  const onPointerEnter = () => {
    if (!hoverSuppressed) {
      setHovered(true);
    }
  };

  const onPointerLeave = () => {
    setHovered(false);
    setPressed(false);
    setSettlingToggle(null);
  };

  if (!isBitmap) return null;

  return (
    <button
      ref={btnRef}
      type="button"
      tabIndex={-1}
      className={[
        "skin-bitmap-btn",
        usesGif && "skin-bitmap-btn--canvas",
        hasDisabledAsset && "skin-bitmap-btn--has-disabled",
        !usesGif && showHover && "skin-bitmap-btn--hover",
        !usesGif && showPressed && "skin-bitmap-btn--pressed",
      ]
        .filter(Boolean)
        .join(" ")}
      data-node-id={node.id}
      {...skinDragRegionNoneProps()}
      disabled={Boolean(actionDisabled)}
      aria-label={tooltip || node.id || clickAction}
      title={tooltip || undefined}
      style={
        {
          "--skin-btn-w": `${width}px`,
          "--skin-btn-h": `${height}px`,
          ...(!usesGif
            ? {
                "--skin-btn-img": `url("${src}")`,
                "--skin-btn-img-hover": `url("${hoverSrc}")`,
                "--skin-btn-img-pressed": `url("${pressedSrc}")`,
                ...(hasDisabledAsset
                  ? { "--skin-btn-img-disabled": `url("${disabledSrc}")` }
                  : {}),
              }
            : {}),
        } as React.CSSProperties
      }
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onClick={() => {
        playSkinSound(
          pack,
          resolveSkinClickSound(node.sound, node.soundWhen, bindState),
        );
        if (node.activeWhen) {
          setSettlingToggle({ prevSticky: Boolean(isSticky) });
          setPressed(false);
        }
        suppressSkinButtonHoverUntilPointerMove();
        scheduleSkinEffects(node.onClick, () => bindState);
      }}
    >
      {usesGif ? (
        <SkinInteractiveAssetCanvas
          assetFile={activeFile}
          assetUrl={activeUrl}
          width={width}
          height={height}
          animate={animate}
          playKey={playKey}
        />
      ) : null}
    </button>
  );
}

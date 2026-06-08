import { useEffect, useMemo, useState, type PointerEvent } from "react";
import { skinAssetUrl, skinPackAssetUrl } from "../../../lib/skinAssets";
import {
  loadButtonGroupPositionMap,
  parseMappingColor,
  type ButtonGroupPositionMap,
} from "../../../lib/skinButtonGroupMap";
import { runSkinAction } from "../../../lib/skinActions";
import { skinDragRegionNoneProps } from "../../../lib/skinDragRegion";
import { useSkinDebug } from "../../../hooks/useSkinDebug";
import type { ButtonGroupNode, LoadedSkinPack } from "../../../types/skin";
import "./SkinButtonGroup.css";

function resolveLocalPointer(
  event: PointerEvent<HTMLButtonElement>,
  mapWidth: number,
  mapHeight: number,
): { x: number; y: number } | null {
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  return {
    x: ((event.clientX - rect.left) / rect.width) * mapWidth,
    y: ((event.clientY - rect.top) / rect.height) * mapHeight,
  };
}

export function SkinButtonGroup({
  node,
  pack,
}: {
  node: ButtonGroupNode;
  pack: LoadedSkinPack;
}) {
  const presentation = node.presentation;
  const skinDebug = useSkinDebug();
  const [positionMap, setPositionMap] = useState<ButtonGroupPositionMap | null>(
    null,
  );
  const [hoveredAction, setHoveredAction] = useState<string | null>(null);
  const [pressedAction, setPressedAction] = useState<string | null>(null);
  const [debugAction, setDebugAction] = useState<string | null>(null);

  const mapUrl = skinPackAssetUrl(pack.packDir, presentation.positionMap);
  const mapWidth = presentation.width ?? node.bounds?.w ?? 44;
  const mapHeight = presentation.height ?? node.bounds?.h ?? 50;

  const colorToAction = useMemo(() => {
    const map = new Map<string, string>();
    for (const element of presentation.elements) {
      const rgb = parseMappingColor(element.mappingColor);
      if (!rgb) continue;
      map.set(`${rgb.r},${rgb.g},${rgb.b}`, element.action);
    }
    return map;
  }, [presentation.elements]);

  const actionToMask = useMemo(() => {
    const map = new Map<string, string>();
    if (!positionMap) return map;
    for (const [colorKey, maskUrl] of positionMap.colorMasks) {
      const action = colorToAction.get(colorKey);
      if (action) map.set(action, maskUrl);
    }
    return map;
  }, [positionMap, colorToAction]);

  useEffect(() => {
    let cancelled = false;
    void loadButtonGroupPositionMap(mapUrl)
      .then((loaded) => {
        if (!cancelled) setPositionMap(loaded);
      })
      .catch((err: unknown) => {
        console.error("Failed to load button group map:", err);
        if (!cancelled) setPositionMap(null);
      });

    return () => {
      cancelled = true;
    };
  }, [mapUrl]);

  const hoverFormat = presentation.animatedHover ? "gif" : "png";
  const src = skinAssetUrl(pack.packDir, presentation.assetBase);
  const hoverSrc = skinAssetUrl(
    pack.packDir,
    presentation.assetBase,
    "hover",
    hoverFormat,
  );
  const pressedSrc = skinAssetUrl(pack.packDir, presentation.assetBase, "pressed");

  const actionAtPointer = (event: PointerEvent<HTMLButtonElement>): string | null => {
    if (!positionMap) return null;
    const point = resolveLocalPointer(event, mapWidth, mapHeight);
    if (!point) return null;
    return positionMap.actionAt(point.x, point.y, colorToAction);
  };

  const activateAt = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;

    const action = actionAtPointer(event);
    if (skinDebug) {
      setDebugAction(action ?? "(none)");
    }
    if (!action) return;

    event.preventDefault();
    event.stopPropagation();
    setPressedAction(action);
    runSkinAction(action);
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const action = actionAtPointer(event);
    setHoveredAction(action);
    if (skinDebug) {
      setDebugAction(action ?? "(none)");
    }
  };

  const onPointerLeave = () => {
    setHoveredAction(null);
    setDebugAction(null);
  };

  const finishPress = () => {
    setPressedAction(null);
  };

  const activeAction = pressedAction ?? hoveredAction;
  const activeMaskUrl = activeAction ? actionToMask.get(activeAction) : null;
  const overlaySrc = pressedAction ? pressedSrc : hoverSrc;

  const overlayStyle =
    activeMaskUrl
      ? ({
          backgroundImage: `url("${overlaySrc}")`,
          WebkitMaskImage: `url("${activeMaskUrl}")`,
          maskImage: `url("${activeMaskUrl}")`,
        } as React.CSSProperties)
      : undefined;

  return (
    <div
      className={[
        "skin-button-group-wrap",
        skinDebug && "skin-button-group-wrap--debug",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {skinDebug ? (
        <div
          className="skin-button-group__debug-map"
          style={{ backgroundImage: `url("${mapUrl}")` }}
          aria-hidden
        />
      ) : null}
      {skinDebug && debugAction ? (
        <div className="skin-button-group__debug-label" aria-hidden>
          {debugAction}
        </div>
      ) : null}
      <button
        type="button"
        className="skin-button-group"
        data-node-id={node.id}
        {...skinDragRegionNoneProps()}
        aria-label={node.id ?? "Window controls"}
        style={{
          backgroundImage: `url("${src}")`,
          cursor: hoveredAction ? "pointer" : "default",
        }}
        onPointerDown={activateAt}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerUp={finishPress}
        onPointerCancel={finishPress}
      />
      {overlayStyle ? (
        <div
          className="skin-button-group__overlay"
          style={overlayStyle}
          aria-hidden
        />
      ) : null}
    </div>
  );
}

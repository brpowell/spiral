import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { skinAssetUrl, skinPackAssetUrl } from "../../../lib/skinAssets";
import {
  loadButtonGroupPositionMap,
  parseMappingColor,
  type ButtonGroupPositionMap,
} from "../../../lib/skinButtonGroupMap";
import { runSkinAction, skinControlPayload } from "../../../lib/skinActions";
import { playSkinSound } from "../../../lib/skinSoundEffects";
import {
  evaluateSkinBind,
  isSkinBindDisabled,
  useSkinBindState,
} from "../../../lib/skinBinds";
import { skinDragRegionNoneProps } from "../../../lib/skinDragRegion";
import { useSkinDebug } from "../../../hooks/useSkinDebug";
import type {
  ButtonGroupElement,
  ButtonGroupNode,
  LoadedSkinPack,
  SkinBindPath,
} from "../../../types/skin";
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
  const bindState = useSkinBindState();
  const [positionMap, setPositionMap] = useState<ButtonGroupPositionMap | null>(
    null,
  );
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const [debugLabel, setDebugLabel] = useState<string | null>(null);
  const pendingPressKeyRef = useRef<string | null>(null);

  const mapUrl = skinPackAssetUrl(pack.packDir, presentation.positionMap);
  const mapWidth = presentation.width ?? node.bounds?.w ?? 44;
  const mapHeight = presentation.height ?? node.bounds?.h ?? 50;

  // Key elements by their mapping color (not by action) so a group that repeats
  // an action with different payloads (e.g. skin.toggleView per viewId) keeps
  // each button distinct for hover, press, masking, and dispatch.
  const keyToElement = useMemo(() => {
    const map = new Map<string, ButtonGroupElement>();
    for (const element of presentation.elements) {
      const rgb = parseMappingColor(element.mappingColor);
      if (!rgb) continue;
      map.set(`${rgb.r},${rgb.g},${rgb.b}`, element);
    }
    return map;
  }, [presentation.elements]);

  const validKeys = useMemo(() => new Set(keyToElement.keys()), [keyToElement]);

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

  const isElementDisabled = (element: ButtonGroupElement): boolean =>
    isSkinBindDisabled(element.disabledWhen, bindState);

  const overlayLayers = useMemo(() => {
    const layers: Array<{ key: string; src: string }> = [];
    for (const [key, element] of keyToElement) {
      if (isElementDisabled(element)) continue;

      const isPressed = pressedKey === key;
      const isHovered = hoveredKey === key;
      const isSticky =
        element.activeWhen &&
        Boolean(
          evaluateSkinBind(element.activeWhen as SkinBindPath, bindState),
        );

      if (isPressed || (!isHovered && isSticky)) {
        layers.push({ key, src: pressedSrc });
      } else if (isHovered) {
        layers.push({ key, src: hoverSrc });
      }
    }
    return layers;
  }, [
    keyToElement,
    pressedKey,
    hoveredKey,
    bindState,
    pressedSrc,
    hoverSrc,
  ]);

  const keyAtPointer = (event: PointerEvent<HTMLButtonElement>): string | null => {
    if (!positionMap) return null;
    const point = resolveLocalPointer(event, mapWidth, mapHeight);
    if (!point) return null;
    const key = positionMap.keyAt(point.x, point.y, validKeys);
    if (!key) return null;
    const element = keyToElement.get(key);
    if (element && isElementDisabled(element)) return null;
    return key;
  };

  const debugLabelForKey = (key: string | null): string => {
    if (!key) return "(none)";
    const element = keyToElement.get(key);
    if (!element) return "(none)";
    return element.viewId
      ? `${element.action} (${element.viewId})`
      : element.action;
  };

  const updateHoverFromEvent = (event: PointerEvent<HTMLButtonElement>) => {
    const key = keyAtPointer(event);
    setHoveredKey(key);
    if (skinDebug) {
      setDebugLabel(debugLabelForKey(key));
    }
  };

  const beginPress = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;

    const key = keyAtPointer(event);
    if (skinDebug) {
      setDebugLabel(debugLabelForKey(key));
    }
    if (!key) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    pendingPressKeyRef.current = key;
    setPressedKey(key);
  };

  const onPointerMove = updateHoverFromEvent;

  const onPointerEnter = updateHoverFromEvent;

  const onPointerLeave = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) return;
    setHoveredKey(null);
    setDebugLabel(null);
  };

  const finishPress = (event: PointerEvent<HTMLButtonElement>) => {
    const pending = pendingPressKeyRef.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const keyAtRelease = keyAtPointer(event);
    if (pending && keyAtRelease === pending) {
      const element = keyToElement.get(pending);
      if (element && !isElementDisabled(element)) {
        playSkinSound(pack, element.sound ?? presentation.sound);
        runSkinAction(element.action, {
          ...skinControlPayload(element),
          ...element.payload,
        });
      }
    }

    pendingPressKeyRef.current = null;
    setPressedKey(null);
    setHoveredKey(keyAtRelease);
  };

  const onLostPointerCapture = () => {
    pendingPressKeyRef.current = null;
    setPressedKey(null);
  };

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
      {skinDebug && debugLabel ? (
        <div className="skin-button-group__debug-label" aria-hidden>
          {debugLabel}
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
          cursor: hoveredKey ? "pointer" : "default",
        }}
        onPointerDown={beginPress}
        onPointerMove={onPointerMove}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onPointerUp={finishPress}
        onPointerCancel={finishPress}
        onLostPointerCapture={onLostPointerCapture}
      />
      {overlayLayers.map(({ key, src }) => {
        const maskUrl = positionMap?.colorMasks.get(key);
        if (!maskUrl) return null;
        return (
          <div
            key={key}
            className="skin-button-group__overlay"
            style={{
              backgroundImage: `url("${src}")`,
              WebkitMaskImage: `url("${maskUrl}")`,
              maskImage: `url("${maskUrl}")`,
            }}
            aria-hidden
          />
        );
      })}
    </div>
  );
}

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
import {
  suppressSkinButtonHoverUntilPointerMove,
  useSkinButtonHoverSuppressed,
} from "../../../lib/skinButtonHoverSuppression";
import { useSkinDebug } from "../../../hooks/useSkinDebug";
import { resolveSkinTooltip } from "../../../lib/skinTooltips";
import type {
  ButtonGroupElement,
  ButtonGroupNode,
  LoadedSkinPack,
  SkinBindPath,
} from "../../../types/skin";
import "./SkinButtonGroup.css";

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
  const hitRefs = useRef(new Map<string, HTMLButtonElement>());
  const hoverSuppressed = useSkinButtonHoverSuppressed();
  // Hold pressed graphic until activeWhen bind catches up (aux windows can lag).
  const [settlingToggle, setSettlingToggle] = useState<{
    key: string;
    prevSticky: boolean;
  } | null>(null);

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

  const hitRegions = useMemo(() => {
    if (!positionMap) return [];
    return positionMap.regions.filter((region) => validKeys.has(region.colorKey));
  }, [positionMap, validKeys]);

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

  useEffect(() => {
    if (hoverSuppressed) {
      setHoveredKey(null);
      return;
    }
    for (const [key, el] of hitRefs.current) {
      if (el.matches(":hover")) {
        setHoveredKey(key);
        return;
      }
    }
  }, [hoverSuppressed]);

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

  const isElementSticky = (element: ButtonGroupElement): boolean =>
    Boolean(
      element.activeWhen &&
        evaluateSkinBind(element.activeWhen as SkinBindPath, bindState),
    );

  useEffect(() => {
    if (!settlingToggle) return;
    const element = keyToElement.get(settlingToggle.key);
    if (!element || isElementSticky(element) !== settlingToggle.prevSticky) {
      setSettlingToggle(null);
      return;
    }
    const timeout = window.setTimeout(() => setSettlingToggle(null), 1000);
    return () => window.clearTimeout(timeout);
  }, [settlingToggle, keyToElement, bindState]);

  const overlayLayers = useMemo(() => {
    const layers: Array<{ key: string; src: string }> = [];
    for (const [key, element] of keyToElement) {
      if (isElementDisabled(element)) continue;

      const isPressed = pressedKey === key;
      const isHovered = hoveredKey === key && !hoverSuppressed;
      const isSticky = isElementSticky(element);
      const isSettling = settlingToggle?.key === key;

      if (isPressed || isSticky || isSettling) {
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
    hoverSuppressed,
    bindState,
    settlingToggle,
    pressedSrc,
    hoverSrc,
  ]);

  const debugLabelForKey = (key: string | null): string => {
    if (!key) return "(none)";
    const element = keyToElement.get(key);
    if (!element) return "(none)";
    return element.viewId
      ? `${element.action} (${element.viewId})`
      : element.action;
  };

  const beginPress = (
    event: PointerEvent<HTMLButtonElement>,
    key: string,
  ) => {
    if (event.button !== 0) return;

    const element = keyToElement.get(key);
    if (skinDebug) {
      setDebugLabel(debugLabelForKey(key));
    }
    if (!element || isElementDisabled(element)) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    pendingPressKeyRef.current = key;
    setPressedKey(key);
  };

  const finishPress = (
    event: PointerEvent<HTMLButtonElement>,
    key: string,
  ) => {
    const pending = pendingPressKeyRef.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (pending && pending === key) {
      const element = keyToElement.get(pending);
      if (element && !isElementDisabled(element)) {
        playSkinSound(pack, element.sound ?? presentation.sound);
        if (element.activeWhen) {
          setSettlingToggle({
            key: pending,
            prevSticky: isElementSticky(element),
          });
        }
        runSkinAction(element.action, {
          ...skinControlPayload(element),
          ...element.payload,
        });
        suppressSkinButtonHoverUntilPointerMove();
      }
    }

    pendingPressKeyRef.current = null;
    setPressedKey(null);
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
      <div
        className="skin-button-group"
        data-node-id={node.id}
        style={{ backgroundImage: `url("${src}")` }}
        aria-hidden
      />
      {hitRegions.map((region) => {
        const element = keyToElement.get(region.colorKey);
        if (!element) return null;
        const disabled = isElementDisabled(element);
        const regionTooltip = resolveSkinTooltip(
          {
            action: element.action,
            panelId: element.panelId,
            viewId: element.viewId,
            tooltip: element.tooltip,
            tooltipWhen: element.tooltipWhen,
          },
          bindState,
        );
        return (
          <button
            key={region.colorKey}
            ref={(el) => {
              if (el) hitRefs.current.set(region.colorKey, el);
              else hitRefs.current.delete(region.colorKey);
            }}
            type="button"
            className="skin-button-group__hit"
            data-node-id={node.id}
            {...skinDragRegionNoneProps()}
            disabled={disabled}
            aria-label={regionTooltip ?? element.action}
            title={regionTooltip}
            style={{
              left: `${(region.x / mapWidth) * 100}%`,
              top: `${(region.y / mapHeight) * 100}%`,
              width: `${(region.w / mapWidth) * 100}%`,
              height: `${(region.h / mapHeight) * 100}%`,
              cursor: disabled ? "default" : "pointer",
            }}
            onPointerDown={(event) => beginPress(event, region.colorKey)}
            onPointerEnter={() => {
              if (!hoverSuppressed) {
                setHoveredKey(region.colorKey);
              }
              if (skinDebug) {
                setDebugLabel(debugLabelForKey(region.colorKey));
              }
            }}
            onPointerLeave={() => {
              setHoveredKey((current) =>
                current === region.colorKey ? null : current,
              );
            }}
            onPointerUp={(event) => finishPress(event, region.colorKey)}
            onPointerCancel={(event) => finishPress(event, region.colorKey)}
            onLostPointerCapture={onLostPointerCapture}
          />
        );
      })}
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

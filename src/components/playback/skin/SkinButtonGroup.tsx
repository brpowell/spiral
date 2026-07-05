import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { skinAssetFileUrl, resolveInteractiveAssetUrl } from "../../../lib/skinAssets";
import {
  loadButtonGroupPositionMap,
  parseMappingColor,
  type ButtonGroupPositionMap,
} from "../../../lib/skinButtonGroupMap";
import { runSkinAction, skinControlPayload } from "../../../lib/skinActions";
import { playSkinSound } from "../../../lib/skinSoundEffects";
import {
  evaluateSkinCondition,
  isSkinControlEnabled,
  useSkinBindState,
} from "../../../lib/skinBinds";
import { skinDragRegionNoneProps } from "../../../lib/skinDragRegion";
import {
  suppressSkinButtonHoverUntilPointerMove,
  useSkinButtonHoverSuppressed,
} from "../../../lib/skinButtonHoverSuppression";
import { useSkinDebug } from "../../../hooks/useSkinDebug";
import { resolveSkinTooltip } from "../../../lib/skinTooltips";
import { useSkinButtonGroupHitRegistry } from "./SkinButtonGroupHitRegistry";
import type {
  ButtonGroupElement,
  ButtonGroupNode,
  LoadedSkinPack,
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
  const hitRegistry = useSkinButtonGroupHitRegistry();
  const setPressedNodeId = hitRegistry?.setPressedNodeId;
  const [positionMap, setPositionMap] = useState<ButtonGroupPositionMap | null>(
    null,
  );
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const [debugLabel, setDebugLabel] = useState<string | null>(null);
  const pendingPressKeyRef = useRef<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hitRef = useRef<HTMLButtonElement>(null);
  const hoverSuppressed = useSkinButtonHoverSuppressed();
  // Hold pressed graphic until activeWhen bind catches up (aux windows can lag).
  const [settlingToggle, setSettlingToggle] = useState<{
    key: string;
    prevSticky: boolean;
  } | null>(null);

  const mapUrl = skinAssetFileUrl(pack.packDir, presentation.positionMap);

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
  const isPlaying = evaluateSkinCondition("player.isPlaying", bindState);

  const playColorKey = useMemo(() => {
    for (const [key, element] of keyToElement) {
      if (element.action === "player.play") return key;
    }
    return null;
  }, [keyToElement]);

  const effectiveValidKeys = useMemo(() => {
    if (!isPlaying || !playColorKey) return validKeys;
    const keys = new Set(validKeys);
    keys.delete(playColorKey);
    return keys;
  }, [validKeys, isPlaying, playColorKey]);

  const defaultLayerMaskUrl = useMemo(() => {
    if (!isPlaying || !playColorKey || !positionMap) return undefined;
    return positionMap.excludeColorMasks.get(playColorKey);
  }, [isPlaying, playColorKey, positionMap]);

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

  const isElementDisabled = (element: ButtonGroupElement): boolean =>
    !isSkinControlEnabled(element.enabledWhen, bindState);

  const isElementSticky = (element: ButtonGroupElement): boolean =>
    Boolean(
      element.activeWhen &&
        evaluateSkinCondition(element.activeWhen, bindState),
    );

  const debugLabelForKey = useCallback(
    (key: string | null): string => {
      if (!key) return "(none)";
      const element = keyToElement.get(key);
      if (!element) return "(none)";
      return element.viewId
        ? `${element.action} (${element.viewId})`
        : element.action;
    },
    [keyToElement],
  );

  const sampleKeyAt = useCallback(
    (clientX: number, clientY: number): string | null => {
      const wrap = wrapRef.current;
      if (!positionMap || !wrap) return null;

      const rect = wrap.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;

      const mapX = ((clientX - rect.left) / rect.width) * positionMap.width;
      const mapY = ((clientY - rect.top) / rect.height) * positionMap.height;
      const key = positionMap.keyAt(mapX, mapY, effectiveValidKeys);
      if (!key) return null;

      const element = keyToElement.get(key);
      if (!element || isElementDisabled(element)) return null;
      return key;
    },
    [positionMap, effectiveValidKeys, keyToElement, bindState],
  );

  const syncHoverFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      if (hoverSuppressed) return;

      if (hitRegistry) {
        hitRegistry.syncHoverAt(clientX, clientY);
      } else {
        const key = sampleKeyAt(clientX, clientY);
        setHoveredKey(key);
      }

      if (skinDebug) {
        const resolved = hitRegistry?.resolveHitAt(clientX, clientY);
        const key =
          resolved && resolved.entry.nodeId === node.id
            ? resolved.key
            : hitRegistry
              ? null
              : sampleKeyAt(clientX, clientY);
        setDebugLabel(debugLabelForKey(key));
      }
    },
    [
      hoverSuppressed,
      hitRegistry,
      sampleKeyAt,
      skinDebug,
      debugLabelForKey,
      node.id,
    ],
  );

  const keyAtPointer = useCallback(
    (clientX: number, clientY: number): string | null => {
      if (hitRegistry) {
        const resolved = hitRegistry.resolveHitAt(clientX, clientY);
        return resolved && resolved.entry.nodeId === node.id
          ? resolved.key
          : null;
      }
      return sampleKeyAt(clientX, clientY);
    },
    [hitRegistry, sampleKeyAt, node.id],
  );

  const syncPressedFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const pending = pendingPressKeyRef.current;
      if (!pending) return;

      const key = keyAtPointer(clientX, clientY);
      if (key === pending) {
        setPressedKey(pending);
        setPressedNodeId?.(node.id ?? null);
      } else {
        setPressedKey(null);
        setPressedNodeId?.(null);
      }
    },
    [keyAtPointer, setPressedNodeId, node.id],
  );

  const syncPointerFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      syncHoverFromPointer(clientX, clientY);
      syncPressedFromPointer(clientX, clientY);
    },
    [syncHoverFromPointer, syncPressedFromPointer],
  );

  useEffect(() => {
    if (hoverSuppressed) {
      setHoveredKey(null);
    }
  }, [hoverSuppressed]);

  const src = resolveInteractiveAssetUrl(
    pack.packDir,
    presentation.assets,
    presentation.assetsWhen,
    bindState,
    "default",
  );
  const hoverSrc = resolveInteractiveAssetUrl(
    pack.packDir,
    presentation.assets,
    presentation.assetsWhen,
    bindState,
    "hover",
  );
  const pressedSrc = resolveInteractiveAssetUrl(
    pack.packDir,
    presentation.assets,
    presentation.assetsWhen,
    bindState,
    "pressed",
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
      if (isPlaying && element.action === "player.play") continue;

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
    isPlaying,
  ]);

  const hoveredElement = hoveredKey ? keyToElement.get(hoveredKey) : undefined;
  const hitTooltip = hoveredElement
    ? resolveSkinTooltip(
        {
          action: hoveredElement.action,
          panelId: hoveredElement.panelId,
          viewId: hoveredElement.viewId,
          tooltip: hoveredElement.tooltip,
          tooltipWhen: hoveredElement.tooltipWhen,
        },
        bindState,
      )
    : undefined;

  const startPress = useCallback(
    (key: string, event: PointerEvent<HTMLButtonElement>) => {
      if (skinDebug) {
        setDebugLabel(debugLabelForKey(key));
      }

      event.preventDefault();
      event.stopPropagation();
      const captureTarget = hitRef.current ?? event.currentTarget;
      captureTarget.setPointerCapture(event.pointerId);
      pendingPressKeyRef.current = key;
      syncPressedFromPointer(event.clientX, event.clientY);
    },
    [skinDebug, debugLabelForKey, syncPressedFromPointer],
  );

  const finishPress = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const pending = pendingPressKeyRef.current;
      const captureTarget = hitRef.current ?? event.currentTarget;
      if (captureTarget.hasPointerCapture(event.pointerId)) {
        captureTarget.releasePointerCapture(event.pointerId);
      }

      const keyAtRelease = keyAtPointer(event.clientX, event.clientY);

      if (pending !== null && keyAtRelease === pending) {
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
      setPressedNodeId?.(null);
      hitRegistry?.syncHoverAt(event.clientX, event.clientY);
    },
    [
      keyAtPointer,
      keyToElement,
      bindState,
      pack,
      presentation.sound,
      hitRegistry,
      setPressedNodeId,
    ],
  );

  useEffect(() => {
    if (!hitRegistry || !node.id) return;

    return hitRegistry.register({
      nodeId: node.id,
      elevateWhen: presentation.elevateWhen,
      sampleKeyAt,
      setHoveredKey,
      startPress,
      finishPress,
    });
  }, [
    hitRegistry,
    node.id,
    presentation.elevateWhen,
    sampleKeyAt,
    startPress,
    finishPress,
  ]);

  const beginPress = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;

    const resolved = hitRegistry?.resolveHitAt(event.clientX, event.clientY);
    if (hitRegistry) {
      if (!resolved) return;
      if (resolved.entry.nodeId !== node.id) {
        resolved.entry.startPress(resolved.key, event);
        return;
      }
      startPress(resolved.key, event);
      return;
    }

    const key = sampleKeyAt(event.clientX, event.clientY);
    if (!key) return;
    startPress(key, event);
  };

  const onLostPointerCapture = () => {
    pendingPressKeyRef.current = null;
    setPressedKey(null);
    setPressedNodeId?.(null);
  };

  return (
    <div
      ref={wrapRef}
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
        style={{
          backgroundImage: `url("${src}")`,
          ...(defaultLayerMaskUrl
            ? {
                WebkitMaskImage: `url("${defaultLayerMaskUrl}")`,
                maskImage: `url("${defaultLayerMaskUrl}")`,
                WebkitMaskSize: "100% 100%",
                maskSize: "100% 100%",
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
              }
            : undefined),
        }}
        aria-hidden
      />
      {positionMap ? (
        <button
          ref={hitRef}
          type="button"
          className="skin-button-group__hit"
          data-node-id={node.id}
          {...skinDragRegionNoneProps()}
          aria-label={hitTooltip ?? node.id ?? "Button group"}
          title={hitTooltip}
          style={{ cursor: hoveredKey ? "pointer" : "default" }}
          onPointerDown={beginPress}
          onPointerEnter={(event) =>
            syncPointerFromPointer(event.clientX, event.clientY)
          }
          onPointerMove={(event) =>
            syncPointerFromPointer(event.clientX, event.clientY)
          }
          onPointerLeave={(event) => {
            syncPressedFromPointer(event.clientX, event.clientY);
            if (hitRegistry) {
              hitRegistry.syncHoverAt(event.clientX, event.clientY);
            } else {
              setHoveredKey(null);
            }
            if (skinDebug) setDebugLabel("(none)");
          }}
          onPointerUp={finishPress}
          onPointerCancel={finishPress}
          onLostPointerCapture={onLostPointerCapture}
        />
      ) : null}
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

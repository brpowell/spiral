import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as audio from "../../../lib/audio";
import { skinPackAssetUrl } from "../../../lib/skinAssets";
import {
  loadStripSliderPositionMap,
  sampleStripSliderPointer,
  type StripSliderPointerSample,
  type StripSliderPositionMap,
} from "../../../lib/skinStripSliderMap";
import { usePlaybackProgress } from "../../../hooks/usePlaybackProgress";
import { useSkinDebug } from "../../../hooks/useSkinDebug";
import { usePlayerStore } from "../../../store/usePlayerStore";
import type { LoadedSkinPack, SeekbarNode, VolumeNode } from "../../../types/skin";
import "./SkinStripSlider.css";

type StripSliderNode = SeekbarNode | VolumeNode;

export function SkinStripSlider({
  node,
  pack,
  mode,
}: {
  node: StripSliderNode;
  pack: LoadedSkinPack;
  mode: "seek" | "volume";
}) {
  const presentation = node.presentation;
  if (presentation.kind !== "stripSlider") return null;

  const {
    strip,
    positionMap,
    frameWidth,
    frameHeight,
    frameCount,
    direction = mode === "volume" ? "vertical" : "horizontal",
    invert = false,
    classPrefix,
  } = presentation;

  const hitRef = useRef<HTMLButtonElement>(null);
  const skinDebug = useSkinDebug();
  const [positionMapData, setPositionMapData] =
    useState<StripSliderPositionMap | null>(null);
  const [debugSample, setDebugSample] =
    useState<StripSliderPointerSample | null>(null);

  const stripUrl = skinPackAssetUrl(pack.packDir, strip);
  const mapUrl = positionMap
    ? skinPackAssetUrl(pack.packDir, positionMap)
    : null;

  useEffect(() => {
    if (!mapUrl) {
      setPositionMapData(null);
      return;
    }
    let cancelled = false;
    void loadStripSliderPositionMap(mapUrl, frameCount, direction)
      .then((map) => {
        if (!cancelled) setPositionMapData(map);
      })
      .catch((err: unknown) => {
        console.error("Failed to load strip slider position map:", err);
        if (!cancelled) setPositionMapData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [mapUrl, frameCount, direction]);

  const library = usePlayerStore((s) => s.library);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);

  const currentTrack = useMemo(
    () => library.find((t) => t.id === currentTrackId),
    [library, currentTrackId],
  );
  const durationSeconds =
    currentTrack?.durationSeconds ?? audio.getDurationSeconds();

  const {
    isSeeking,
    seekValue,
    progress,
    disabled: seekDisabled,
    handleSeekStart,
    handleSeekChange,
    handleSeekEnd,
  } = usePlaybackProgress(durationSeconds);

  const valueRatio = mode === "volume" ? volume : isSeeking ? seekValue : progress;
  const disabled = mode === "volume" ? false : seekDisabled;

  const displayFrame = Math.round(valueRatio * (frameCount - 1));

  const resolvedFrameHeight = frameHeight ?? (mode === "volume" ? 128 : 113);
  const stripWidth = frameWidth * frameCount;

  const displayStyle = {
    backgroundImage: `url("${stripUrl}")`,
    backgroundSize: `${stripWidth}px ${resolvedFrameHeight}px`,
    backgroundPosition: `-${displayFrame * frameWidth}px 0`,
  } as React.CSSProperties;

  const samplePointer = useCallback(
    (clientX: number, clientY: number): StripSliderPointerSample | null => {
      const el = hitRef.current;
      if (!el) return null;
      return sampleStripSliderPointer(
        clientX,
        clientY,
        el.getBoundingClientRect(),
        positionMapData,
        frameCount,
        direction,
        invert,
      );
    },
    [positionMapData, frameCount, direction, invert],
  );

  const pointerToRatio = useCallback(
    (clientX: number, clientY: number): number =>
      samplePointer(clientX, clientY)?.ratio ?? 0,
    [samplePointer],
  );

  const applyRatio = useCallback(
    (ratio: number, commit: boolean) => {
      if (mode === "volume") {
        setVolume(ratio);
      } else if (commit) {
        handleSeekEnd(ratio);
      } else {
        handleSeekChange(ratio);
      }
    },
    [mode, setVolume, handleSeekChange, handleSeekEnd],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (mode === "seek") handleSeekStart();
    applyRatio(pointerToRatio(event.clientX, event.clientY), false);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (skinDebug) {
      setDebugSample(samplePointer(event.clientX, event.clientY));
    }
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || disabled) return;
    applyRatio(pointerToRatio(event.clientX, event.clientY), false);
  };

  const onPointerLeave = () => {
    if (skinDebug) setDebugSample(null);
  };

  const finishDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    applyRatio(pointerToRatio(event.clientX, event.clientY), mode !== "volume");
  };

  const className = [
    "skin-strip-slider",
    skinDebug && "skin-strip-slider--debug",
    classPrefix,
  ]
    .filter(Boolean)
    .join(" ");

  const debugLines = [
    `display ${displayFrame}/${frameCount - 1}`,
    debugSample
      ? `pointer ${debugSample.frame}/${frameCount - 1} (${debugSample.source})`
      : null,
    debugSample
      ? `ratio ${debugSample.ratio.toFixed(3)} map ${Math.round(debugSample.mapX)},${Math.round(debugSample.mapY)}`
      : null,
  ].filter(Boolean);

  return (
    <div
      className={className}
      data-node-id={node.id}
      data-frame={displayFrame}
    >
      <div className="skin-strip-slider__display" style={displayStyle} />
      {skinDebug && mapUrl ? (
        <div
          className="skin-strip-slider__debug-map"
          style={{ backgroundImage: `url("${mapUrl}")` }}
          aria-hidden
        />
      ) : null}
      {skinDebug ? (
        <div className="skin-strip-slider__debug-label" aria-hidden>
          {debugLines.join("\n")}
        </div>
      ) : null}
      <button
        ref={hitRef}
        type="button"
        className="skin-strip-slider__hit"
        disabled={disabled}
        aria-label={mode === "volume" ? "Volume" : "Seek"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      />
    </div>
  );
}

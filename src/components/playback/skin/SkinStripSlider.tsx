import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EQ_BAND_FREQUENCIES_HZ,
  formatEqBandFrequency,
  gainDbToRatio,
  ratioToGainDb,
} from "../../../lib/equalizer/types";
import { applyEqBandSliderGain } from "../../../lib/eqBandInput";
import * as audio from "../../../lib/playback";
import { findPlaybackTrack } from "../../../lib/playbackTrack";
import { skinAssetFileUrl } from "../../../lib/skinAssets";
import {
  inferStripSliderStripLayout,
  loadStripSliderPositionMap,
  ratioToStripFrame,
  sampleStripSliderPointer,
  type StripSliderOffMapFallback,
  type StripSliderPointerSample,
  type StripSliderPositionMap,
} from "../../../lib/skinStripSliderMap";
import { usePlaybackProgress } from "../../../hooks/usePlaybackProgress";
import { useSkinDebug } from "../../../hooks/useSkinDebug";
import {
  useSkinBindState,
  useSkinControlEnabled,
} from "../../../lib/skinBinds";
import { resolveSkinTooltip } from "../../../lib/skinTooltips";
import { useEqualizerStore } from "../../../store/useEqualizerStore";
import { usePlayerStore } from "../../../store/usePlayerStore";
import type { LoadedSkinPack, SliderNode } from "../../../types/skin";
import "./SkinStripSlider.css";

export function SkinStripSlider({
  node,
  pack,
  mode,
}: {
  node: SliderNode;
  pack: LoadedSkinPack;
  mode: "seek" | "volume" | "eq";
}) {
  const presentation = node.presentation;
  if (presentation.kind !== "stripSlider") return null;

  const eqBand = mode === "eq" && node.control === "eq" ? node.band : null;

  const {
    strip,
    positionMap,
    frameWidth,
    frameHeight,
    frameCount,
    direction = mode === "volume" || mode === "eq" ? "vertical" : "horizontal",
    valueFrames = "ascending",
    mapFrames = "ascending",
  } = presentation;

  const hitRef = useRef<HTMLButtonElement>(null);
  const dragAnchorFrameRef = useRef<number | null>(null);
  const lastRatioRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const skinDebug = useSkinDebug();
  const [positionMapData, setPositionMapData] =
    useState<StripSliderPositionMap | null>(null);
  const [stripLayout, setStripLayout] = useState<"horizontal" | "vertical">(
    "horizontal",
  );
  const [debugSample, setDebugSample] =
    useState<StripSliderPointerSample | null>(null);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [mapHitActive, setMapHitActive] = useState(false);
  const bindState = useSkinBindState();
  const interactionEnabled = useSkinControlEnabled(node.enabledWhen);

  const stripUrl = skinAssetFileUrl(pack.packDir, strip);
  const mapUrl = positionMap
    ? skinAssetFileUrl(pack.packDir, positionMap)
    : null;

  const resolvedFrameHeight = frameHeight ?? (mode === "volume" ? 128 : 113);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      setStripLayout(
        inferStripSliderStripLayout(
          img.naturalWidth,
          img.naturalHeight,
          frameWidth,
          resolvedFrameHeight,
          frameCount,
        ),
      );
    };
    img.onerror = () => {
      if (!cancelled) setStripLayout("horizontal");
    };
    img.src = stripUrl;
    return () => {
      cancelled = true;
    };
  }, [stripUrl, frameWidth, resolvedFrameHeight, frameCount]);

  useEffect(() => {
    if (!mapUrl) {
      setPositionMapData(null);
      return;
    }
    let cancelled = false;
    void loadStripSliderPositionMap(mapUrl, frameCount, direction, {
      stripUrl,
      frameWidth,
      frameHeight: frameHeight ?? (mode === "volume" ? 128 : 113),
      mapFrames,
    })
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
  }, [
    mapUrl,
    stripUrl,
    frameCount,
    frameWidth,
    frameHeight,
    direction,
    mapFrames,
    mode,
  ]);

  const library = usePlayerStore((s) => s.library);
  const playbackTracks = usePlayerStore((s) => s.playbackTracks);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const volume = usePlayerStore((s) => (mode === "volume" ? s.volume : 0));
  const setVolume = usePlayerStore((s) => s.setVolume);

  const bandGain = useEqualizerStore((s) =>
    eqBand !== null ? s.bands[eqBand - 1] : 0,
  );

  const currentTrack = useMemo(
    () => findPlaybackTrack({ library, playbackTracks, currentTrackId }),
    [library, playbackTracks, currentTrackId],
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

  const valueRatio =
    mode === "eq"
      ? gainDbToRatio(bandGain)
      : mode === "volume"
        ? volume
        : isSeeking
          ? seekValue
          : progress;
  const disabled =
    mode === "eq"
      ? !interactionEnabled
      : mode === "volume"
        ? !interactionEnabled
        : seekDisabled || !interactionEnabled;

  const displayFrame = ratioToStripFrame(valueRatio, frameCount, valueFrames);

  const displayStyle =
    stripLayout === "vertical"
      ? ({
          backgroundImage: `url("${stripUrl}")`,
          backgroundSize: `${frameWidth}px ${resolvedFrameHeight * frameCount}px`,
          backgroundPosition: `0 -${displayFrame * resolvedFrameHeight}px`,
        } as React.CSSProperties)
      : ({
          backgroundImage: `url("${stripUrl}")`,
          backgroundSize: `${frameWidth * frameCount}px ${resolvedFrameHeight}px`,
          backgroundPosition: `-${displayFrame * frameWidth}px 0`,
        } as React.CSSProperties);

  const samplePointer = useCallback(
    (
      clientX: number,
      clientY: number,
      anchorFrame?: number,
      offMapFallback: StripSliderOffMapFallback = "none",
    ): StripSliderPointerSample | null => {
      const el = hitRef.current;
      if (!el) return null;
      return sampleStripSliderPointer(
        clientX,
        clientY,
        el.getBoundingClientRect(),
        positionMapData,
        frameCount,
        direction,
        valueFrames,
        anchorFrame,
        offMapFallback,
      );
    },
    [positionMapData, frameCount, direction, valueFrames],
  );

  const applyRatio = useCallback(
    (ratio: number, commit: boolean) => {
      lastRatioRef.current = ratio;
      if (mode === "eq") {
        if (node.control !== "eq") return;
        applyEqBandSliderGain(node, pack, ratioToGainDb(ratio));
      } else if (mode === "volume") {
        setVolume(ratio);
      } else if (commit) {
        handleSeekEnd(ratio);
      } else {
        handleSeekChange(ratio);
      }
    },
    [mode, node, pack, setVolume, handleSeekChange, handleSeekEnd],
  );

  const applyPointer = useCallback(
    (
      clientX: number,
      clientY: number,
      anchorFrame: number,
      commit: boolean,
      offMapFallback: StripSliderOffMapFallback = "none",
    ) => {
      const sample = samplePointer(
        clientX,
        clientY,
        anchorFrame,
        offMapFallback,
      );
      if (sample) {
        applyRatio(sample.ratio, commit);
        dragAnchorFrameRef.current = ratioToStripFrame(
          sample.ratio,
          frameCount,
          valueFrames,
        );
        return;
      }
      if (commit && lastRatioRef.current !== null) {
        applyRatio(lastRatioRef.current, true);
      }
    },
    [samplePointer, applyRatio, frameCount, valueFrames],
  );

  const updateMapHitState = useCallback(
    (
      clientX: number,
      clientY: number,
      anchorFrame: number,
      dragging: boolean,
    ) => {
      if (disabled) {
        setMapHitActive(false);
        return;
      }
      if (dragging) {
        setMapHitActive(true);
        return;
      }
      setMapHitActive(samplePointer(clientX, clientY, anchorFrame) !== null);
    },
    [disabled, samplePointer],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const sample = samplePointer(event.clientX, event.clientY, displayFrame);
    if (!sample) return;
    setMapHitActive(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    if (mode === "seek") handleSeekStart();
    dragAnchorFrameRef.current = displayFrame;
    applyRatio(sample.ratio, false);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const anchorFrame = dragAnchorFrameRef.current ?? displayFrame;
    const dragging = event.currentTarget.hasPointerCapture(event.pointerId);
    const offMapFallback: StripSliderOffMapFallback = dragging
      ? "nearest"
      : "none";
    const sample = samplePointer(
      event.clientX,
      event.clientY,
      anchorFrame,
      offMapFallback,
    );
    updateMapHitState(event.clientX, event.clientY, anchorFrame, dragging);
    if (sample) setHoverRatio(sample.ratio);
    if (skinDebug) {
      setDebugSample(sample);
    }
    if (!dragging || disabled) return;
    applyPointer(event.clientX, event.clientY, anchorFrame, false, "nearest");
  };

  const onPointerLeave = () => {
    if (draggingRef.current) return;
    setHoverRatio(null);
    setMapHitActive(false);
    if (skinDebug) setDebugSample(null);
  };

  const finishDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    applyPointer(
      event.clientX,
      event.clientY,
      dragAnchorFrameRef.current ?? displayFrame,
      mode === "seek",
      "nearest",
    );
    dragAnchorFrameRef.current = null;
  };

  const className = [
    "skin-strip-slider",
    node.className,
    skinDebug && "skin-strip-slider--debug",
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

  const ariaLabel =
    mode === "eq" && eqBand !== null
      ? `EQ band ${eqBand} (${formatEqBandFrequency(EQ_BAND_FREQUENCIES_HZ[eqBand - 1])} Hz)`
      : mode === "volume"
        ? "Volume"
        : "Seek";

  const liveRatio = hoverRatio ?? valueRatio;
  const tooltip = useMemo(
    () =>
      resolveSkinTooltip(
        {
          id: node.id,
          tooltip: node.tooltip,
          tooltipWhen: node.tooltipWhen,
        },
        bindState,
        {
          sliderMode: mode === "eq" ? "eq" : mode,
          ratio: liveRatio,
          eqBand: eqBand ?? undefined,
        },
      ),
    [
      node.id,
      node.tooltip,
      node.tooltipWhen,
      bindState,
      mode,
      liveRatio,
      eqBand,
    ],
  );

  return (
    <div className={className} data-node-id={node.id} data-frame={displayFrame}>
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
        className={[
          "skin-strip-slider__hit",
          mapHitActive && "skin-strip-slider__hit--interactive",
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={disabled}
        aria-label={tooltip || ariaLabel}
        title={tooltip || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerEnter={(event) => {
          const sample = samplePointer(
            event.clientX,
            event.clientY,
            displayFrame,
          );
          updateMapHitState(event.clientX, event.clientY, displayFrame, false);
          if (sample) setHoverRatio(sample.ratio);
        }}
        onPointerLeave={onPointerLeave}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      />
    </div>
  );
}

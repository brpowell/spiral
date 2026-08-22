import { useCallback, useMemo, useState, type PointerEvent } from "react";
import {
  EQ_BAND_FREQUENCIES_HZ,
  formatEqBandFrequency,
  gainDbToRatio,
  ratioToGainDb,
} from "../../../lib/equalizer/types";
import { applyEqBandSliderGain } from "../../../lib/eqBandInput";
import {
  resolveThumbAssetFile,
  skinAssetFileUrl,
} from "../../../lib/skinAssets";
import { skinDragRegionNoneProps } from "../../../lib/skinDragRegion";
import { wmpTiledTrackStyle } from "../../../lib/wmpTiledTrack";
import {
  pointInThumb,
  wmpCrossAxisOffset,
  wmpSliderFillSpan,
  wmpVerticalPointerToRatio,
  wmpVerticalThumbTop,
} from "../../../lib/wmpBitmapSliderThumb";
import {
  useSkinBindState,
  useSkinControlEnabled,
} from "../../../lib/skinBinds";
import { resolveSkinTooltip } from "../../../lib/skinTooltips";
import { useEqualizerStore } from "../../../store/useEqualizerStore";
import { usePlayerStore } from "../../../store/usePlayerStore";
import type {
  EqBandNode,
  LoadedSkinPack,
  VolumeNode,
} from "../../../types/skin";
import "./SkinBitmapVerticalSlider.css";

type VerticalSliderNode = EqBandNode | VolumeNode;

export function SkinBitmapVerticalSlider({
  node,
  pack,
}: {
  node: VerticalSliderNode;
  pack: LoadedSkinPack;
}) {
  const presentation = node.presentation;
  if (presentation.kind !== "bitmapVerticalSlider") return null;

  const mode = node.type === "eqBand" ? "eq" : "volume";

  const {
    track,
    thumb,
    trackTileWidth: trackTileWidthRaw,
    trackTileHeight: trackTileHeightRaw,
    trackWidth,
    trackHeight,
    thumbWidth,
    thumbHeight,
    borderSize = 0,
    fill,
  } = presentation;
  const trackTileWidth = trackTileWidthRaw ?? trackWidth;
  const trackTileHeight = trackTileHeightRaw ?? trackHeight;

  const band = node.type === "eqBand" ? node.band : 0;
  const bandGain = useEqualizerStore((s) =>
    mode === "eq" ? s.bands[band - 1] : 0,
  );
  const volume = usePlayerStore((s) => (mode === "volume" ? s.volume : 0));
  const setVolume = usePlayerStore((s) => s.setVolume);
  const bindState = useSkinBindState();
  const interactionEnabled = useSkinControlEnabled(node.enabledWhen);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [hoveringThumb, setHoveringThumb] = useState(false);
  const [dragging, setDragging] = useState(false);
  const ratio =
    mode === "eq" ? gainDbToRatio(bandGain) : Math.min(1, Math.max(0, volume));

  const thumbTop = wmpVerticalThumbTop({
    ratio,
    trackHeight,
    thumbHeight,
    borderSize,
  });
  const thumbLeft = wmpCrossAxisOffset(trackWidth, thumbWidth);
  const trackLeft = wmpCrossAxisOffset(trackWidth, trackTileWidth);
  const fillHeight = wmpSliderFillSpan({
    ratio,
    trackLength: trackHeight,
    borderSize,
  });

  const trackUrl = track ? skinAssetFileUrl(pack.packDir, track) : null;
  const fillUrl = fill ? skinAssetFileUrl(pack.packDir, fill) : null;
  const activeThumbUrl = skinAssetFileUrl(
    pack.packDir,
    resolveThumbAssetFile(thumb, { dragging, hovering: hoveringThumb }),
  );

  const pointerToRatio = useCallback(
    (clientY: number, rect: DOMRect): number =>
      wmpVerticalPointerToRatio({
        localY: clientY - rect.top,
        trackHeight,
        borderSize,
      }),
    [borderSize, trackHeight],
  );

  const updateThumbHover = useCallback(
    (clientX: number, clientY: number, rect: DOMRect) => {
      setHoveringThumb(
        pointInThumb({
          localX: clientX - rect.left,
          localY: clientY - rect.top,
          thumbLeft,
          thumbTop,
          thumbWidth,
          thumbHeight,
        }),
      );
    },
    [thumbLeft, thumbTop, thumbWidth, thumbHeight],
  );

  const applyRatio = useCallback(
    (nextRatio: number) => {
      if (mode === "eq" && node.type === "eqBand") {
        applyEqBandSliderGain(node, pack, ratioToGainDb(nextRatio));
        return;
      }
      setVolume(nextRatio);
    },
    [mode, node, pack, setVolume],
  );

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!interactionEnabled) return;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    applyRatio(
      pointerToRatio(
        event.clientY,
        event.currentTarget.getBoundingClientRect(),
      ),
    );
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const nextRatio = pointerToRatio(event.clientY, rect);
    setHoverRatio(nextRatio);
    updateThumbHover(event.clientX, event.clientY, rect);
    if (
      !event.currentTarget.hasPointerCapture(event.pointerId) ||
      !interactionEnabled
    )
      return;
    applyRatio(nextRatio);
  };

  const finishPointer = (event: PointerEvent<HTMLButtonElement>) => {
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const rect = event.currentTarget.getBoundingClientRect();
    applyRatio(pointerToRatio(event.clientY, rect));
    updateThumbHover(event.clientX, event.clientY, rect);
  };

  const className = ["skin-bitmap-vertical-slider", node.className]
    .filter(Boolean)
    .join(" ");

  const liveRatio = hoverRatio ?? ratio;
  const tooltip = useMemo(
    () =>
      resolveSkinTooltip(
        { id: node.id, tooltip: node.tooltip, tooltipWhen: node.tooltipWhen },
        bindState,
        {
          sliderMode: mode === "eq" ? "eq" : "volume",
          ratio: liveRatio,
          eqBand: mode === "eq" ? band : undefined,
        },
      ),
    [node.id, node.tooltip, node.tooltipWhen, bindState, mode, liveRatio, band],
  );

  const fallbackLabel =
    mode === "eq"
      ? `EQ band ${band} (${formatEqBandFrequency(EQ_BAND_FREQUENCIES_HZ[band - 1])} Hz)`
      : "Volume";

  return (
    <div className={className} data-node-id={node.id}>
      {trackUrl && (
        <div
          className="skin-bitmap-vertical-slider__track"
          style={{
            left: `${trackLeft}px`,
            ...wmpTiledTrackStyle({
              trackUrl,
              trackTileWidth,
              trackTileHeight,
              trackWidth: trackTileWidth,
              trackHeight,
              borderSize,
              direction: "vertical",
            }),
          }}
          aria-hidden
        />
      )}
      {fillUrl && (
        <div
          className="skin-bitmap-vertical-slider__fill"
          style={{
            left: `${trackLeft}px`,
            bottom: 0,
            width: `${trackWidth}px`,
            height: `${fillHeight}px`,
            backgroundImage: `url("${fillUrl}")`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "bottom center",
            backgroundSize: `${trackWidth}px ${trackHeight}px`,
          }}
          aria-hidden
        />
      )}
      <img
        className="skin-bitmap-vertical-slider__thumb"
        src={activeThumbUrl}
        alt=""
        draggable={false}
        style={{
          width: `${thumbWidth}px`,
          height: `${thumbHeight}px`,
          left: `${thumbLeft}px`,
          top: `${thumbTop}px`,
        }}
        aria-hidden
      />
      <button
        type="button"
        className="skin-bitmap-vertical-slider__hit"
        disabled={!interactionEnabled}
        aria-label={tooltip || fallbackLabel}
        title={tooltip || undefined}
        {...skinDragRegionNoneProps()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onPointerEnter={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setHoverRatio(pointerToRatio(event.clientY, rect));
          updateThumbHover(event.clientX, event.clientY, rect);
        }}
        onPointerLeave={() => {
          setHoveringThumb(false);
          setHoverRatio(null);
        }}
      />
    </div>
  );
}

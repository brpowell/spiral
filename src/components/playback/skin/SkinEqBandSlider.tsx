import { useCallback, useMemo, useState, type PointerEvent } from "react";
import {
  EQ_BAND_FREQUENCIES_HZ,
  formatEqBandFrequency,
  gainDbToRatio,
  ratioToGainDb,
} from "../../../lib/equalizer/types";
import { skinAssetFileUrl } from "../../../lib/skinAssets";
import { skinDragRegionNoneProps } from "../../../lib/skinDragRegion";
import { wmpTiledTrackStyle } from "../../../lib/wmpTiledTrack";
import { useSkinBindState, useSkinControlEnabled } from "../../../lib/skinBinds";
import { resolveSkinTooltip } from "../../../lib/skinTooltips";
import { useEqualizerStore } from "../../../store/useEqualizerStore";
import type { EqBandNode, LoadedSkinPack } from "../../../types/skin";
import "./SkinEqBandSlider.css";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function SkinEqBandSlider({
  node,
  pack,
}: {
  node: EqBandNode;
  pack: LoadedSkinPack;
}) {
  const presentation = node.presentation;
  if (presentation.kind !== "bitmapVerticalSlider") return null;

  const {
    track,
    thumb,
    thumbPressed,
    trackTileWidth: trackTileWidthRaw,
    trackTileHeight: trackTileHeightRaw,
    trackWidth,
    trackHeight,
    thumbWidth,
    thumbHeight,
    borderSize = 0,
    fillFromBottom = false,
    classPrefix,
  } = presentation;
  const trackTileWidth = trackTileWidthRaw ?? trackWidth;
  const trackTileHeight = trackTileHeightRaw ?? trackHeight;

  const bandGain = useEqualizerStore((s) => s.bands[node.band - 1]);
  const setBand = useEqualizerStore((s) => s.setBand);
  const bindState = useSkinBindState();
  const interactionEnabled = useSkinControlEnabled(node.enabledWhen);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const ratio = gainDbToRatio(bandGain);

  const travel = Math.max(0, trackHeight - borderSize * 2 - thumbHeight);
  const thumbTop = borderSize + (1 - ratio) * travel;
  const thumbLeft = (trackWidth - thumbWidth) / 2;
  const trackLeft = (trackWidth - trackTileWidth) / 2;

  const trackUrl = track ? skinAssetFileUrl(pack.packDir, track) : null;
  const thumbUrl = skinAssetFileUrl(pack.packDir, thumb);
  const thumbPressedUrl = thumbPressed
    ? skinAssetFileUrl(pack.packDir, thumbPressed)
    : null;
  const activeThumbUrl =
    dragging && thumbPressedUrl ? thumbPressedUrl : thumbUrl;

  const pointerToRatio = useCallback(
    (clientY: number, rect: DOMRect): number => {
      const localY = clientY - rect.top;
      if (travel <= 0) return 0.5;
      return clamp01(1 - (localY - borderSize - thumbHeight / 2) / travel);
    },
    [borderSize, thumbHeight, travel],
  );

  const applyRatio = useCallback(
    (nextRatio: number) => {
      setBand(node.band - 1, ratioToGainDb(nextRatio));
    },
    [node.band, setBand],
  );

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!interactionEnabled) return;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    applyRatio(pointerToRatio(event.clientY, event.currentTarget.getBoundingClientRect()));
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const nextRatio = pointerToRatio(
      event.clientY,
      event.currentTarget.getBoundingClientRect(),
    );
    setHoverRatio(nextRatio);
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || !interactionEnabled) return;
    applyRatio(nextRatio);
  };

  const finishPointer = (event: PointerEvent<HTMLButtonElement>) => {
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    applyRatio(pointerToRatio(event.clientY, event.currentTarget.getBoundingClientRect()));
  };

  const className = ["skin-eq-band-slider", classPrefix].filter(Boolean).join(" ");

  const liveRatio = hoverRatio ?? ratio;
  const tooltip = useMemo(
    () =>
      resolveSkinTooltip(
        { id: node.id, tooltip: node.tooltip, tooltipWhen: node.tooltipWhen },
        bindState,
        { sliderMode: "eq", ratio: liveRatio, eqBand: node.band },
      ),
    [node.id, node.tooltip, node.tooltipWhen, node.band, bindState, liveRatio],
  );

  return (
    <div
      className={className}
      data-node-id={node.id}
      style={{ width: "100%", height: "100%" }}
    >
      {trackUrl &&
        (fillFromBottom ? (
          <div
            className="skin-eq-band-slider__fill"
            style={{
              left: `${trackLeft}px`,
              bottom: 0,
              width: `${trackTileWidth}px`,
              height: `${Math.round(ratio * trackHeight)}px`,
              backgroundImage: `url("${trackUrl}")`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "bottom center",
              backgroundSize: `${trackTileWidth}px ${trackHeight}px`,
            }}
            aria-hidden
          />
        ) : (
          <div
            className="skin-eq-band-slider__track"
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
        ))}
      <img
        className="skin-eq-band-slider__thumb"
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
        className="skin-eq-band-slider__hit"
        disabled={!interactionEnabled}
        aria-label={
          tooltip ||
          `EQ band ${node.band} (${formatEqBandFrequency(EQ_BAND_FREQUENCIES_HZ[node.band - 1])} Hz)`
        }
        title={tooltip || undefined}
        {...skinDragRegionNoneProps()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onPointerEnter={(event) =>
          setHoverRatio(
            pointerToRatio(event.clientY, event.currentTarget.getBoundingClientRect()),
          )
        }
        onPointerLeave={() => setHoverRatio(null)}
      />
    </div>
  );
}

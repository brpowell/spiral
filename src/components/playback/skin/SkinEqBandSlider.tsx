import { useCallback, type PointerEvent } from "react";
import {
  EQ_BAND_FREQUENCIES_HZ,
  formatEqBandFrequency,
  gainDbToRatio,
  ratioToGainDb,
} from "../../../lib/equalizer/types";
import { skinAssetUrl } from "../../../lib/skinAssets";
import { skinDragRegionNoneProps } from "../../../lib/skinDragRegion";
import { wmpTiledTrackStyle } from "../../../lib/wmpTiledTrack";
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
    trackTileWidth,
    trackTileHeight,
    trackWidth,
    trackHeight,
    thumbWidth,
    thumbHeight,
    borderSize = 0,
    classPrefix,
  } = presentation;

  const bandGain = useEqualizerStore((s) => s.bands[node.band - 1]);
  const setBand = useEqualizerStore((s) => s.setBand);
  const ratio = gainDbToRatio(bandGain);

  const travel = Math.max(0, trackHeight - borderSize * 2 - thumbHeight);
  const thumbTop = borderSize + (1 - ratio) * travel;
  const thumbLeft = (trackWidth - thumbWidth) / 2;
  const trackLeft = (trackWidth - trackTileWidth) / 2;

  const trackUrl = skinAssetUrl(pack.packDir, track);
  const thumbUrl = skinAssetUrl(pack.packDir, thumb);

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
    event.currentTarget.setPointerCapture(event.pointerId);
    applyRatio(pointerToRatio(event.clientY, event.currentTarget.getBoundingClientRect()));
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    applyRatio(pointerToRatio(event.clientY, event.currentTarget.getBoundingClientRect()));
  };

  const finishPointer = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    applyRatio(pointerToRatio(event.clientY, event.currentTarget.getBoundingClientRect()));
  };

  const className = ["skin-eq-band-slider", classPrefix].filter(Boolean).join(" ");

  return (
    <div
      className={className}
      data-node-id={node.id}
      style={{ width: `${trackWidth}px`, height: `${trackHeight}px` }}
    >
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
      <img
        className="skin-eq-band-slider__thumb"
        src={thumbUrl}
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
        aria-label={`EQ band ${node.band} (${formatEqBandFrequency(EQ_BAND_FREQUENCIES_HZ[node.band - 1])} Hz)`}
        {...skinDragRegionNoneProps()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
      />
    </div>
  );
}

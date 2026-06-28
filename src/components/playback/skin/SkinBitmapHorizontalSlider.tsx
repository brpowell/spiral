import { useCallback, useMemo, useState, type PointerEvent } from "react";
import { skinAssetUrl } from "../../../lib/skinAssets";
import { skinDragRegionNoneProps } from "../../../lib/skinDragRegion";
import { wmpTiledTrackStyle } from "../../../lib/wmpTiledTrack";
import { useSkinBindState } from "../../../lib/skinBinds";
import { resolveSkinTooltip } from "../../../lib/skinTooltips";
import { usePlayerStore } from "../../../store/usePlayerStore";
import type {
  BalanceNode,
  LoadedSkinPack,
  VolumeNode,
} from "../../../types/skin";
import "./SkinBitmapHorizontalSlider.css";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function balanceToRatio(balance: number): number {
  return (balance + 1) / 2;
}

function ratioToBalance(ratio: number): number {
  return ratio * 2 - 1;
}

type HorizontalSliderNode = BalanceNode | VolumeNode;

export function SkinBitmapHorizontalSlider({
  node,
  pack,
}: {
  node: HorizontalSliderNode;
  pack: LoadedSkinPack;
}) {
  const presentation = node.presentation;
  if (presentation.kind !== "bitmapHorizontalSlider") return null;

  const mode = node.type === "balance" ? "balance" : "volume";

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

  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const balance = usePlayerStore((s) => s.balance);
  const setBalance = usePlayerStore((s) => s.setBalance);
  const bindState = useSkinBindState();
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);

  const ratio =
    mode === "balance" ? balanceToRatio(balance) : clamp01(volume);

  const travel = Math.max(0, trackWidth - borderSize * 2 - thumbWidth);
  const thumbLeft = borderSize + ratio * travel;
  const thumbTop = (trackHeight - thumbHeight) / 2;
  const trackTop = (trackHeight - trackTileHeight) / 2;

  const trackUrl = skinAssetUrl(pack.packDir, track);
  const thumbUrl = skinAssetUrl(pack.packDir, thumb);

  const pointerToRatio = useCallback(
    (clientX: number, rect: DOMRect): number => {
      const localX = clientX - rect.left;
      if (travel <= 0) return mode === "balance" ? 0.5 : 0;
      return clamp01((localX - borderSize - thumbWidth / 2) / travel);
    },
    [borderSize, mode, thumbWidth, travel],
  );

  const applyRatio = useCallback(
    (nextRatio: number) => {
      if (mode === "balance") {
        setBalance(ratioToBalance(nextRatio));
        return;
      }
      setVolume(nextRatio);
    },
    [mode, setBalance, setVolume],
  );

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    applyRatio(pointerToRatio(event.clientX, event.currentTarget.getBoundingClientRect()));
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const nextRatio = pointerToRatio(
      event.clientX,
      event.currentTarget.getBoundingClientRect(),
    );
    setHoverRatio(nextRatio);
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    applyRatio(nextRatio);
  };

  const finishPointer = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    applyRatio(pointerToRatio(event.clientX, event.currentTarget.getBoundingClientRect()));
  };

  const className = ["skin-bitmap-horizontal-slider", classPrefix]
    .filter(Boolean)
    .join(" ");

  const liveRatio = hoverRatio ?? ratio;
  const tooltip = useMemo(
    () =>
      resolveSkinTooltip(
        { id: node.id, tooltip: node.tooltip, tooltipWhen: node.tooltipWhen },
        bindState,
        { sliderMode: mode, ratio: liveRatio },
      ),
    [node.id, node.tooltip, node.tooltipWhen, bindState, mode, liveRatio],
  );

  return (
    <div
      className={className}
      data-node-id={node.id}
      style={{ width: "100%", height: "100%" }}
    >
      <div
        className="skin-bitmap-horizontal-slider__track"
        style={{
          top: `${trackTop}px`,
          ...wmpTiledTrackStyle({
            trackUrl,
            trackTileWidth,
            trackTileHeight,
            trackWidth,
            trackHeight: trackTileHeight,
            borderSize,
            direction: "horizontal",
          }),
        }}
        aria-hidden
      />
      <img
        className="skin-bitmap-horizontal-slider__thumb"
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
        className="skin-bitmap-horizontal-slider__hit"
        aria-label={tooltip || (mode === "balance" ? "Balance" : "Volume")}
        title={tooltip || undefined}
        {...skinDragRegionNoneProps()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onPointerEnter={(event) =>
          setHoverRatio(
            pointerToRatio(event.clientX, event.currentTarget.getBoundingClientRect()),
          )
        }
        onPointerLeave={() => setHoverRatio(null)}
      />
    </div>
  );
}

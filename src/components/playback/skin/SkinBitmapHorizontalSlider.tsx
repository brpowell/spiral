import { useCallback, useMemo, useState, type PointerEvent } from "react";
import {
  EQ_BAND_FREQUENCIES_HZ,
  formatEqBandFrequency,
  gainDbToRatio,
  ratioToGainDb,
} from "../../../lib/equalizer/types";
import { applyEqBandSliderGain } from "../../../lib/eqBandInput";
import { findPlaybackTrack } from "../../../lib/playbackTrack";
import {
  resolveThumbAssetFile,
  skinAssetFileUrl,
} from "../../../lib/skinAssets";
import { skinDragRegionNoneProps } from "../../../lib/skinDragRegion";
import { wmpTiledTrackStyle } from "../../../lib/wmpTiledTrack";
import {
  pointInThumb,
  wmpCrossAxisOffset,
  wmpHorizontalPointerToRatio,
  wmpHorizontalThumbLeft,
  wmpSliderFillSpan,
} from "../../../lib/wmpBitmapSliderThumb";
import {
  useSkinBindState,
  useSkinControlEnabled,
} from "../../../lib/skinBinds";
import { resolveSkinTooltip } from "../../../lib/skinTooltips";
import * as audio from "../../../lib/playback";
import { usePlaybackProgress } from "../../../hooks/usePlaybackProgress";
import { useEqualizerStore } from "../../../store/useEqualizerStore";
import { usePlayerStore } from "../../../store/usePlayerStore";
import type {
  BalanceNode,
  EqBandNode,
  LoadedSkinPack,
  SeekbarNode,
  VolumeNode,
} from "../../../types/skin";
import "./SkinBitmapHorizontalSlider.css";

function balanceToRatio(balance: number): number {
  return (balance + 1) / 2;
}

function ratioToBalance(ratio: number): number {
  return ratio * 2 - 1;
}

type HorizontalSliderNode = BalanceNode | VolumeNode | SeekbarNode | EqBandNode;
type HorizontalSliderMode = "seek" | "balance" | "volume" | "eq";

export function SkinBitmapHorizontalSlider({
  node,
  pack,
}: {
  node: HorizontalSliderNode;
  pack: LoadedSkinPack;
}) {
  if (node.presentation.kind !== "bitmapHorizontalSlider") return null;

  if (node.type === "seekbar") {
    return <HorizontalSeekSlider node={node} pack={pack} />;
  }
  if (node.type === "balance") {
    return <HorizontalBalanceSlider node={node} pack={pack} />;
  }
  if (node.type === "eqBand") {
    return <HorizontalEqBandSlider node={node} pack={pack} />;
  }
  return <HorizontalVolumeSlider node={node} pack={pack} />;
}

function HorizontalSeekSlider({
  node,
  pack,
}: {
  node: SeekbarNode;
  pack: LoadedSkinPack;
}) {
  const library = usePlayerStore((s) => s.library);
  const playbackTracks = usePlayerStore((s) => s.playbackTracks);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
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

  const applyRatio = useCallback(
    (nextRatio: number, phase: "start" | "move" | "end") => {
      if (phase === "start") handleSeekStart();
      if (phase === "end") {
        handleSeekEnd(nextRatio);
        return;
      }
      handleSeekChange(nextRatio);
    },
    [handleSeekStart, handleSeekChange, handleSeekEnd],
  );

  return (
    <BitmapHorizontalSliderView
      node={node}
      pack={pack}
      mode="seek"
      ratio={isSeeking ? seekValue : progress}
      hitDisabled={seekDisabled}
      applyRatio={applyRatio}
    />
  );
}

function HorizontalVolumeSlider({
  node,
  pack,
}: {
  node: VolumeNode;
  pack: LoadedSkinPack;
}) {
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const applyRatio = useCallback(
    (nextRatio: number) => {
      setVolume(nextRatio);
    },
    [setVolume],
  );

  return (
    <BitmapHorizontalSliderView
      node={node}
      pack={pack}
      mode="volume"
      ratio={Math.min(1, Math.max(0, volume))}
      applyRatio={applyRatio}
    />
  );
}

function HorizontalBalanceSlider({
  node,
  pack,
}: {
  node: BalanceNode;
  pack: LoadedSkinPack;
}) {
  const balance = usePlayerStore((s) => s.balance);
  const setBalance = usePlayerStore((s) => s.setBalance);
  const applyRatio = useCallback(
    (nextRatio: number) => {
      setBalance(ratioToBalance(nextRatio));
    },
    [setBalance],
  );

  return (
    <BitmapHorizontalSliderView
      node={node}
      pack={pack}
      mode="balance"
      ratio={balanceToRatio(balance)}
      applyRatio={applyRatio}
    />
  );
}

function HorizontalEqBandSlider({
  node,
  pack,
}: {
  node: EqBandNode;
  pack: LoadedSkinPack;
}) {
  const band = node.band;
  const bandGain = useEqualizerStore((s) => s.bands[band - 1]);
  const applyRatio = useCallback(
    (nextRatio: number) => {
      applyEqBandSliderGain(node, pack, ratioToGainDb(nextRatio));
    },
    [node, pack],
  );

  return (
    <BitmapHorizontalSliderView
      node={node}
      pack={pack}
      mode="eq"
      ratio={gainDbToRatio(bandGain)}
      applyRatio={applyRatio}
    />
  );
}

function BitmapHorizontalSliderView({
  node,
  pack,
  mode,
  ratio,
  hitDisabled: hitDisabledProp = false,
  applyRatio,
}: {
  node: HorizontalSliderNode;
  pack: LoadedSkinPack;
  mode: HorizontalSliderMode;
  ratio: number;
  hitDisabled?: boolean;
  applyRatio: (nextRatio: number, phase: "start" | "move" | "end") => void;
}) {
  const presentation = node.presentation;
  if (presentation.kind !== "bitmapHorizontalSlider") return null;

  const {
    track,
    fill,
    thumb,
    trackTileWidth: trackTileWidthRaw,
    trackTileHeight: trackTileHeightRaw,
    trackWidth,
    trackHeight,
    thumbWidth,
    thumbHeight,
    borderSize = 0,
  } = presentation;
  const trackTileWidth = trackTileWidthRaw ?? trackWidth;
  const trackTileHeight = trackTileHeightRaw ?? trackHeight;

  const bindState = useSkinBindState();
  const interactionEnabled = useSkinControlEnabled(node.enabledWhen);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [hoveringThumb, setHoveringThumb] = useState(false);
  const [dragging, setDragging] = useState(false);

  const thumbLeft = wmpHorizontalThumbLeft({
    ratio,
    trackWidth,
    thumbWidth,
    borderSize,
  });
  const thumbTop = wmpCrossAxisOffset(trackHeight, thumbHeight);
  const trackTop = wmpCrossAxisOffset(trackHeight, trackTileHeight);
  const fillWidth = wmpSliderFillSpan({
    ratio,
    trackLength: trackWidth,
    borderSize,
  });

  const trackUrl = track ? skinAssetFileUrl(pack.packDir, track) : null;
  const fillUrl = fill ? skinAssetFileUrl(pack.packDir, fill) : null;
  const activeThumbUrl = skinAssetFileUrl(
    pack.packDir,
    resolveThumbAssetFile(thumb, { dragging, hovering: hoveringThumb }),
  );

  const hitDisabled = hitDisabledProp || !interactionEnabled;

  const pointerToRatio = useCallback(
    (clientX: number, rect: DOMRect): number =>
      wmpHorizontalPointerToRatio({
        localX: clientX - rect.left,
        trackWidth,
        borderSize,
      }),
    [borderSize, trackWidth],
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

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (hitDisabled) return;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    applyRatio(
      pointerToRatio(
        event.clientX,
        event.currentTarget.getBoundingClientRect(),
      ),
      "start",
    );
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const nextRatio = pointerToRatio(event.clientX, rect);
    setHoverRatio(nextRatio);
    updateThumbHover(event.clientX, event.clientY, rect);
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || hitDisabled)
      return;
    applyRatio(nextRatio, "move");
  };

  const finishPointer = (event: PointerEvent<HTMLButtonElement>) => {
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const rect = event.currentTarget.getBoundingClientRect();
    applyRatio(pointerToRatio(event.clientX, rect), "end");
    updateThumbHover(event.clientX, event.clientY, rect);
  };

  const className = ["skin-bitmap-horizontal-slider", node.className]
    .filter(Boolean)
    .join(" ");

  const liveRatio = hoverRatio ?? ratio;
  const eqBand =
    mode === "eq" && node.type === "eqBand" ? node.band : undefined;
  const tooltip = useMemo(
    () =>
      resolveSkinTooltip(
        { id: node.id, tooltip: node.tooltip, tooltipWhen: node.tooltipWhen },
        bindState,
        { sliderMode: mode, ratio: liveRatio, eqBand },
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

  const fallbackLabel =
    mode === "eq" && eqBand !== undefined
      ? `EQ band ${eqBand} (${formatEqBandFrequency(EQ_BAND_FREQUENCIES_HZ[eqBand - 1])} Hz)`
      : mode === "seek"
        ? "Seek"
        : mode === "balance"
          ? "Balance"
          : "Volume";

  return (
    <div className={className} data-node-id={node.id}>
      {trackUrl && (
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
      )}
      {fillUrl && (
        <div
          className="skin-bitmap-horizontal-slider__fill"
          style={{
            top: `${trackTop}px`,
            width: `${fillWidth}px`,
            height: `${trackHeight}px`,
            backgroundImage: `url("${fillUrl}")`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "left center",
            backgroundSize: `${trackWidth}px ${trackHeight}px`,
          }}
          aria-hidden
        />
      )}
      <img
        className="skin-bitmap-horizontal-slider__thumb"
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
        className="skin-bitmap-horizontal-slider__hit"
        disabled={hitDisabled}
        aria-label={tooltip || fallbackLabel}
        title={tooltip || undefined}
        {...skinDragRegionNoneProps()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onPointerEnter={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setHoverRatio(pointerToRatio(event.clientX, rect));
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

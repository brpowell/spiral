import { useCallback, useMemo, useState, type PointerEvent } from "react";
import { findPlaybackTrack } from "../../../lib/playbackTrack";
import { skinAssetUrl } from "../../../lib/skinAssets";
import { skinDragRegionNoneProps } from "../../../lib/skinDragRegion";
import * as audio from "../../../lib/playback";
import { usePlaybackProgress } from "../../../hooks/usePlaybackProgress";
import { usePlayerStore } from "../../../store/usePlayerStore";
import type { LoadedSkinPack, SeekbarNode } from "../../../types/skin";
import "./SkinBitmapSeekbar.css";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function SkinBitmapSeekbar({
  node,
  pack,
}: {
  node: SeekbarNode;
  pack: LoadedSkinPack;
}) {
  const presentation = node.presentation;
  if (presentation.kind !== "bitmapSeekbar") return null;

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
    disabled,
    handleSeekStart,
    handleSeekChange,
    handleSeekEnd,
  } = usePlaybackProgress(durationSeconds);

  const ratio = isSeeking ? seekValue : progress;

  const {
    track,
    fill,
    thumb,
    borderSize,
    trackWidth,
    trackHeight,
    thumbWidth,
    thumbHeight,
  } = presentation;

  const travel = Math.max(0, trackWidth - borderSize * 2 - thumbWidth);
  const fillTravel = Math.max(0, trackWidth - borderSize * 2);
  const thumbLeft = borderSize + ratio * travel;
  const fillWidth = borderSize + ratio * fillTravel;

  const trackUrl = skinAssetUrl(pack.packDir, track);
  const fillUrl = skinAssetUrl(pack.packDir, fill);
  const thumbUrl = skinAssetUrl(pack.packDir, thumb);
  const thumbHoverUrl = skinAssetUrl(pack.packDir, thumb, "hover");
  const thumbPressedUrl = skinAssetUrl(pack.packDir, thumb, "pressed");

  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  const pointerToRatio = useCallback(
    (clientX: number, rect: DOMRect): number => {
      const localX = clientX - rect.left;
      return clamp01((localX - borderSize) / fillTravel);
    },
    [borderSize, fillTravel],
  );

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setPressed(true);
    handleSeekStart();
    handleSeekChange(pointerToRatio(event.clientX, event.currentTarget.getBoundingClientRect()));
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    handleSeekChange(pointerToRatio(event.clientX, event.currentTarget.getBoundingClientRect()));
  };

  const finishPointer = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPressed(false);
    handleSeekEnd(pointerToRatio(event.clientX, event.currentTarget.getBoundingClientRect()));
  };

  const thumbSrc = useMemo(
    () => (pressed ? thumbPressedUrl : hovered ? thumbHoverUrl : thumbUrl),
    [pressed, hovered, thumbPressedUrl, thumbHoverUrl, thumbUrl],
  );

  return (
    <div
      className="skin-bitmap-seekbar"
      data-node-id={node.id}
      style={{
        width: `${trackWidth}px`,
        height: `${Math.max(trackHeight, thumbHeight)}px`,
      }}
    >
      <div
        className="skin-bitmap-seekbar__track"
        style={{
          top: `${Math.max(0, (thumbHeight - trackHeight) / 2)}px`,
          height: `${trackHeight}px`,
          backgroundImage: `url("${trackUrl}")`,
          backgroundSize: `${trackWidth}px ${trackHeight}px`,
        }}
        aria-hidden
      />
      <div
        className="skin-bitmap-seekbar__fill"
        style={{
          top: `${Math.max(0, (thumbHeight - trackHeight) / 2)}px`,
          width: `${fillWidth}px`,
          height: `${trackHeight}px`,
          backgroundImage: `url("${fillUrl}")`,
          backgroundSize: `${trackWidth}px ${trackHeight}px`,
        }}
        aria-hidden
      />
      <img
        className="skin-bitmap-seekbar__thumb"
        src={thumbSrc}
        alt=""
        draggable={false}
        style={{
          width: `${thumbWidth}px`,
          height: `${thumbHeight}px`,
          left: `${thumbLeft}px`,
        }}
        aria-hidden
      />
      <button
        type="button"
        className="skin-bitmap-seekbar__hit"
        disabled={disabled}
        aria-label="Seek"
        {...skinDragRegionNoneProps()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => {
          setHovered(false);
          setPressed(false);
        }}
      />
    </div>
  );
}

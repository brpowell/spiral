import { useMemo, useState } from "react";
import * as audio from "../../../lib/playback";
import { findPlaybackTrack } from "../../../lib/playbackTrack";
import { skinAssetFileUrl } from "../../../lib/skinAssets";
import {
  digitTimeDisplaySeconds,
  mmssDigitFrames,
  type DigitSlotRole,
} from "../../../lib/skinDigitTime";
import { usePlayheadSeconds } from "../../../hooks/usePlaybackProgress";
import { useSkinTooltip } from "../../../lib/skinTooltips";
import { usePlayerStore } from "../../../store/usePlayerStore";
import type {
  DigitStripPresentation,
  LoadedSkinPack,
  TimeNode,
} from "../../../types/skin";
import "./SkinDigitTime.css";

function slotFrame(
  role: DigitSlotRole,
  digitFrames: ReturnType<typeof mmssDigitFrames>,
  signFrame: number,
): number {
  if (role === "sign") return signFrame;
  return digitFrames[role];
}

export function SkinDigitTime({
  node,
  pack,
}: {
  node: TimeNode;
  pack: LoadedSkinPack;
}) {
  const presentation = node.presentation;
  if (presentation.kind !== "digitStrip") return null;

  return (
    <SkinDigitTimeInner node={node} pack={pack} presentation={presentation} />
  );
}

function SkinDigitTimeInner({
  node,
  pack,
  presentation,
}: {
  node: TimeNode;
  pack: LoadedSkinPack;
  presentation: DigitStripPresentation;
}) {
  const {
    strip,
    frameWidth,
    frameHeight,
    slots,
    signFrameElapsed = 10,
    signFrameRemaining = 11,
  } = presentation;

  const library = usePlayerStore((s) => s.library);
  const playbackTracks = usePlayerStore((s) => s.playbackTracks);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const currentTrack = useMemo(
    () => findPlaybackTrack({ library, playbackTracks, currentTrackId }),
    [library, playbackTracks, currentTrackId],
  );
  const durationSeconds =
    currentTrack?.durationSeconds ?? audio.getDurationSeconds();

  const displayPosition = usePlayheadSeconds();
  const [showElapsed, setShowElapsed] = useState(true);

  const stripUrl = skinAssetFileUrl(pack.packDir, strip);
  const stripWidth = frameWidth * 12;

  const seconds = digitTimeDisplaySeconds(
    showElapsed,
    displayPosition,
    durationSeconds,
  );
  const digitFrames = mmssDigitFrames(seconds);
  const signFrame = showElapsed ? signFrameElapsed : signFrameRemaining;

  const className = ["skin-digit-time", node.className]
    .filter(Boolean)
    .join(" ");

  const tooltip = useSkinTooltip(
    {
      id: node.id,
      tooltip: node.tooltip,
      tooltipWhen: node.tooltipWhen,
    },
    { showElapsed, positionSeconds: displayPosition },
  );

  return (
    <button
      type="button"
      className={`${className} skin-digit-time--interactive`}
      data-node-id={node.id}
      aria-label={tooltip}
      title={tooltip}
      onClick={() => setShowElapsed((v) => !v)}
    >
      {slots.map((slot) => {
        const frame = slotFrame(slot.role, digitFrames, signFrame);
        return (
          <div
            key={slot.role}
            className="skin-digit-time__slot"
            style={{
              left: `${slot.x}px`,
              width: `${frameWidth}px`,
              height: `${frameHeight}px`,
            }}
          >
            <img
              className="skin-digit-time__strip"
              src={stripUrl}
              alt=""
              draggable={false}
              style={{
                width: `${stripWidth}px`,
                height: `${frameHeight}px`,
                marginLeft: `-${frame * frameWidth}px`,
              }}
            />
          </div>
        );
      })}
    </button>
  );
}

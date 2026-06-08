import { useMemo, useState } from "react";
import * as audio from "../../../lib/audio";
import { skinPackAssetUrl } from "../../../lib/skinAssets";
import {
  digitTimeDisplaySeconds,
  mmssDigitFrames,
  type DigitSlotRole,
} from "../../../lib/skinDigitTime";
import { usePlaybackProgress } from "../../../hooks/usePlaybackProgress";
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
    classPrefix,
  } = presentation;

  const library = usePlayerStore((s) => s.library);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const currentTrack = useMemo(
    () => library.find((t) => t.id === currentTrackId),
    [library, currentTrackId],
  );
  const durationSeconds =
    currentTrack?.durationSeconds ?? audio.getDurationSeconds();

  const { displayPosition } = usePlaybackProgress(durationSeconds);
  const [showElapsed, setShowElapsed] = useState(true);

  const stripUrl = skinPackAssetUrl(pack.packDir, strip);
  const stripWidth = frameWidth * 12;

  const seconds = digitTimeDisplaySeconds(
    showElapsed,
    displayPosition,
    durationSeconds,
  );
  const digitFrames = mmssDigitFrames(seconds);
  const signFrame = showElapsed ? signFrameElapsed : signFrameRemaining;

  const className = ["skin-digit-time", classPrefix]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={`${className} skin-digit-time--interactive`}
      data-node-id={node.id}
      aria-label={
        showElapsed ? "Elapsed time, show remaining" : "Remaining time, show elapsed"
      }
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

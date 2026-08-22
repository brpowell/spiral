import type { CSSProperties, ReactNode } from "react";
import { useSkinDebug } from "../../../hooks/useSkinDebug";
import type { AbsoluteBounds } from "../../../lib/skinLayout";
import type { SkinWindowHitKind } from "../../../lib/skinWindowHit";
import type { SkinLayoutTransition } from "../../../types/skin";
import "./SkinBounds.css";

export function SkinBounds({
  bounds,
  children,
  className,
  boundsFor,
  transition,
  windowHit,
}: {
  /** Resolved absolute box (callers must resolve stretch / right anchors first). */
  bounds: AbsoluteBounds;
  children: ReactNode;
  className?: string;
  /** Stable node id for bounds-box CSS (e.g. motion timing on `.skin-bounds`). */
  boundsFor?: string;
  /** When set with durationMs > 0, position/size changes interpolate. */
  transition?: SkinLayoutTransition;
  /** How this box participates in OS click-through. */
  windowHit?: SkinWindowHitKind;
}) {
  const skinDebug = useSkinDebug();
  const durationMs = transition?.durationMs ?? 0;
  const motion = durationMs > 0;
  const style: CSSProperties = {
    left: `${bounds.x}px`,
    top: `${bounds.y}px`,
    width: `${bounds.w}px`,
    height: `${bounds.h}px`,
    zIndex: bounds.zIndex,
    ...(motion
      ? {
          ["--skin-bounds-duration" as string]: `${durationMs}ms`,
          ["--skin-bounds-easing" as string]: transition?.easing ?? "linear",
        }
      : {}),
  };

  return (
    <div
      className={[
        "skin-bounds",
        motion && "skin-bounds--motion",
        skinDebug && "skin-bounds--debug",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
      data-bounds-for={boundsFor}
      data-skin-window-hit={windowHit}
    >
      {skinDebug && boundsFor ? (
        <span className="skin-bounds__debug-label" aria-hidden>
          {boundsFor}
        </span>
      ) : null}
      {children}
    </div>
  );
}

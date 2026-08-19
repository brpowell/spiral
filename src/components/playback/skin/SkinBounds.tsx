import type { CSSProperties, ReactNode } from "react";
import { useSkinDebug } from "../../../hooks/useSkinDebug";
import type { AbsoluteBounds } from "../../../lib/skinLayout";
import type { SkinWindowHitKind } from "../../../lib/skinWindowHit";
import "./SkinBounds.css";

export function SkinBounds({
  bounds,
  children,
  className,
  boundsFor,
  motion,
  windowHit,
}: {
  /** Resolved absolute box (callers must resolve stretch / right anchors first). */
  bounds: AbsoluteBounds;
  children: ReactNode;
  className?: string;
  /** Stable node id for bounds-box CSS (e.g. motion timing on `.skin-bounds`). */
  boundsFor?: string;
  /** When true, position changes animate (panel drawer slides). */
  motion?: boolean;
  /** How this box participates in OS click-through. */
  windowHit?: SkinWindowHitKind;
}) {
  const skinDebug = useSkinDebug();
  const style: CSSProperties = {
    left: `${bounds.x}px`,
    top: `${bounds.y}px`,
    width: `${bounds.w}px`,
    height: `${bounds.h}px`,
    zIndex: bounds.zIndex,
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

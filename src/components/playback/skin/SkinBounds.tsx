import type { CSSProperties, ReactNode } from "react";
import { useSkinDebug } from "../../../hooks/useSkinDebug";
import { skinDragRegionSelfProps } from "../../../lib/skinDragRegion";
import type { LayoutBounds } from "../../../types/skin";
import "./SkinBounds.css";

export function SkinBounds({
  bounds,
  children,
  className,
  dragRegion,
  debugLabel,
}: {
  bounds: LayoutBounds;
  children: ReactNode;
  className?: string;
  dragRegion?: boolean;
  debugLabel?: string;
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
        dragRegion && "skin-bounds--drag",
        skinDebug && "skin-bounds--debug",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
      {...(dragRegion ? skinDragRegionSelfProps() : {})}
    >
      {skinDebug && debugLabel ? (
        <span className="skin-bounds__debug-label" aria-hidden>
          {debugLabel}
        </span>
      ) : null}
      {children}
    </div>
  );
}

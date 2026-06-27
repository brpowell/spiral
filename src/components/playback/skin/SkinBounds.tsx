import type { CSSProperties, ReactNode } from "react";
import { useSkinDebug } from "../../../hooks/useSkinDebug";
import type { LayoutBounds } from "../../../types/skin";
import "./SkinBounds.css";

export function SkinBounds({
  bounds,
  children,
  className,
  debugLabel,
  motion,
}: {
  bounds: LayoutBounds;
  children: ReactNode;
  className?: string;
  debugLabel?: string;
  /** When true, position changes animate (panel drawer slides). */
  motion?: boolean;
}) {
  const skinDebug = useSkinDebug();
  const style: CSSProperties = {
    ...(bounds.right !== undefined
      ? {
          right: `${bounds.right - bounds.w}px`,
          left: "auto",
        }
      : { left: `${bounds.x ?? 0}px` }),
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
      data-node-id={debugLabel}
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

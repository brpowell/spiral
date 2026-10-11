import type { ReactNode } from "react";
import "./SkinOverlayRoot.css";

export function SkinOverlayRoot({
  children,
  zIndex,
  id,
}: {
  children: ReactNode;
  zIndex?: number;
  id?: string;
}) {
  return (
    <div
      className="skin-overlay-root"
      data-node-id={id}
      style={{ zIndex: zIndex ?? 0 }}
    >
      {children}
    </div>
  );
}

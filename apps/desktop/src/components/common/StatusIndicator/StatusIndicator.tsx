import type { ComponentPropsWithoutRef, ReactNode } from "react";
import "./StatusIndicator.css";

export type StatusIndicatorProps = ComponentPropsWithoutRef<"span">;

/** Small accent status dot. Place inside `StatusIndicatorAnchor` for corner overlay. */
export function StatusIndicator({ className, ...props }: StatusIndicatorProps) {
  const classes = ["status-indicator", className].filter(Boolean).join(" ");
  return <span className={classes} aria-hidden {...props} />;
}

export type StatusIndicatorAnchorProps = ComponentPropsWithoutRef<"span"> & {
  children: ReactNode;
};

/** Relative wrapper that positions a child `StatusIndicator` over the top-right corner. */
export function StatusIndicatorAnchor({
  className,
  children,
  ...props
}: StatusIndicatorAnchorProps) {
  const classes = ["status-indicator-anchor", className]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes} {...props}>
      {children}
    </span>
  );
}

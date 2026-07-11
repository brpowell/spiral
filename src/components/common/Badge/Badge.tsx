import type { ComponentPropsWithoutRef, ReactNode } from "react";
import "./Badge.css";

export type BadgeVariant = "neutral" | "accent";

export type BadgeProps = ComponentPropsWithoutRef<"span"> & {
  variant?: BadgeVariant;
  children: ReactNode;
};

export function Badge({
  variant = "neutral",
  className,
  children,
  ...props
}: BadgeProps) {
  const classes = ["badge", `badge--${variant}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} {...props}>
      {children}
    </span>
  );
}

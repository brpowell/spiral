import type { ComponentPropsWithoutRef, CSSProperties } from "react";
import "./Skeleton.css";

export type SkeletonRadius = "sm" | "md" | "pill";

export type SkeletonProps = ComponentPropsWithoutRef<"span"> & {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  radius?: SkeletonRadius;
};

export function Skeleton({
  width,
  height,
  radius = "md",
  className,
  style,
  ...props
}: SkeletonProps) {
  const classes = ["skeleton", `skeleton--${radius}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={classes}
      style={{ width, height, ...style }}
      aria-hidden
      {...props}
    />
  );
}

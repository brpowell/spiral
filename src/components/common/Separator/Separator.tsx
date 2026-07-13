import type { ComponentPropsWithoutRef } from "react";
import "./Separator.css";

export type SeparatorProps = ComponentPropsWithoutRef<"hr">;

export function Separator({ className, ...props }: SeparatorProps) {
  const classes = ["separator", className].filter(Boolean).join(" ");
  return <hr className={classes} {...props} />;
}

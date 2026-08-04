import type { ComponentPropsWithoutRef, CSSProperties } from "react";
import "./ProgressBar.css";

export type ProgressBarSize = "sm" | "md";

export type ProgressBarProps = Omit<
  ComponentPropsWithoutRef<"div">,
  "children" | "role"
> & {
  /** Current progress value. */
  value: number;
  /** Maximum value (defaults to 100). */
  max?: number;
  size?: ProgressBarSize;
  /** Optional visible label (e.g. "42%"). */
  label?: string;
};

function clampPercent(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

export function ProgressBar({
  value,
  max = 100,
  size = "md",
  label,
  className,
  style,
  ...props
}: ProgressBarProps) {
  const percent = clampPercent(value, max);
  const classes = ["progress-bar", `progress-bar--${size}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      style={
        { "--progress-bar-fill": `${percent}%`, ...style } as CSSProperties
      }
      {...props}
    >
      <div
        className="progress-bar__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Number.isFinite(value) ? value : 0}
      >
        <div className="progress-bar__fill" />
      </div>
      {label != null && label !== "" ? (
        <span className="progress-bar__label">{label}</span>
      ) : null}
    </div>
  );
}

import {
  forwardRef,
  useMemo,
  type ComponentPropsWithoutRef,
  type CSSProperties,
} from "react";
import "./Slider.css";

export type SliderProps = Omit<ComponentPropsWithoutRef<"input">, "type">;

function fillPercent(
  value: string | number | readonly string[] | undefined,
  min: string | number | readonly string[] | undefined,
  max: string | number | readonly string[] | undefined,
): string {
  const v = Number(value ?? 0);
  const lo = Number(min ?? 0);
  const hi = Number(max ?? 1);
  if (!Number.isFinite(v) || !Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
    return "0%";
  }
  const pct = Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100));
  return `${pct}%`;
}

export const Slider = forwardRef<HTMLInputElement, SliderProps>(function Slider(
  { className, style, value, min = 0, max = 1, ...props },
  ref,
) {
  const sliderStyle = useMemo(() => {
    const fill = fillPercent(value, min, max);
    return {
      ...style,
      "--slider-fill": fill,
    } as CSSProperties;
  }, [style, value, min, max]);

  return (
    <input
      ref={ref}
      type="range"
      className={["slider", className].filter(Boolean).join(" ")}
      style={sliderStyle}
      value={value}
      min={min}
      max={max}
      {...props}
    />
  );
});

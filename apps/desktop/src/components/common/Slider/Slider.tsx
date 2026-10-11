import {
  forwardRef,
  useCallback,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import "./Slider.css";

export type SliderValueTooltipAxis = "horizontal" | "vertical";
export type SliderValueTooltipSide = "before" | "after";

export type SliderProps = Omit<ComponentPropsWithoutRef<"input">, "type"> & {
  showValueTooltip?: boolean;
  formatValueTooltip?: (value: number) => string;
  valueTooltipAxis?: SliderValueTooltipAxis;
  valueTooltipSide?: SliderValueTooltipSide;
  wrapperClassName?: string;
};

function sliderFillPercent(
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
  {
    className,
    style,
    value,
    min = 0,
    max = 1,
    disabled,
    showValueTooltip = false,
    formatValueTooltip,
    valueTooltipAxis = "horizontal",
    valueTooltipSide = "after",
    wrapperClassName,
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    onBlur,
    onKeyDown,
    onKeyUp,
    ...props
  },
  ref,
) {
  const [isInteracting, setIsInteracting] = useState(false);

  const sliderStyle = useMemo(() => {
    const fill = sliderFillPercent(value, min, max);
    return {
      ...style,
      "--slider-fill": fill,
    } as CSSProperties;
  }, [style, value, min, max]);

  const numericValue = Number(value ?? 0);
  const tooltipLabel =
    formatValueTooltip?.(numericValue) ?? String(numericValue);
  const tooltipPosition = sliderFillPercent(value, min, max);

  const startInteraction = useCallback(() => {
    if (!disabled) {
      setIsInteracting(true);
    }
  }, [disabled]);

  const stopInteraction = useCallback(() => {
    setIsInteracting(false);
  }, []);

  const handlePointerDown = (event: PointerEvent<HTMLInputElement>) => {
    startInteraction();
    onPointerDown?.(event);
  };

  const handlePointerUp = (event: PointerEvent<HTMLInputElement>) => {
    stopInteraction();
    onPointerUp?.(event);
  };

  const handlePointerCancel = (event: PointerEvent<HTMLInputElement>) => {
    stopInteraction();
    onPointerCancel?.(event);
  };

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    stopInteraction();
    onBlur?.(event);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.key === "Home" ||
      event.key === "End" ||
      event.key === "PageUp" ||
      event.key === "PageDown"
    ) {
      startInteraction();
    }
    onKeyDown?.(event);
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLInputElement>) => {
    if (
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.key === "Home" ||
      event.key === "End" ||
      event.key === "PageUp" ||
      event.key === "PageDown"
    ) {
      stopInteraction();
    }
    onKeyUp?.(event);
  };

  const input = (
    <input
      ref={ref}
      type="range"
      className={["slider", className].filter(Boolean).join(" ")}
      style={sliderStyle}
      value={value}
      min={min}
      max={max}
      disabled={disabled}
      onPointerDown={showValueTooltip ? handlePointerDown : onPointerDown}
      onPointerUp={showValueTooltip ? handlePointerUp : onPointerUp}
      onPointerCancel={showValueTooltip ? handlePointerCancel : onPointerCancel}
      onBlur={showValueTooltip ? handleBlur : onBlur}
      onKeyDown={showValueTooltip ? handleKeyDown : onKeyDown}
      onKeyUp={showValueTooltip ? handleKeyUp : onKeyUp}
      {...props}
    />
  );

  if (!showValueTooltip) {
    return input;
  }

  const tooltipStyle = {
    "--slider-tooltip-position": tooltipPosition,
  } as CSSProperties;

  return (
    <div
      className={[
        "slider-field",
        `slider-field--${valueTooltipAxis}`,
        `slider-field--tooltip-${valueTooltipSide}`,
        wrapperClassName,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {input}
      {isInteracting && !disabled ? (
        <span
          className="slider-value-tooltip"
          role="tooltip"
          style={tooltipStyle}
        >
          {tooltipLabel}
        </span>
      ) : null}
    </div>
  );
});

import {
  EQ_GAIN_MAX,
  EQ_GAIN_MIN,
  formatEqGainDb,
  gainDbToRatio,
  snapBandGainNearZero,
} from "../../lib/equalizer/types";
import { Slider } from "../common/Slider/Slider";
import "./EqualizerBandSlider.css";

type EqualizerBandSliderProps = {
  value: number;
  disabled?: boolean;
  showValueTooltip?: boolean;
  "aria-label": string;
  onChange: (value: number) => void;
};

export function EqualizerBandSlider({
  value,
  disabled,
  showValueTooltip = true,
  "aria-label": ariaLabel,
  onChange,
}: EqualizerBandSliderProps) {
  const ratio = gainDbToRatio(value);
  const fillBottom = Math.min(ratio, 0.5) * 100;
  const fillHeight = Math.abs(ratio - 0.5) * 100;

  return (
    <div className="equalizer-band-slider">
      <div className="equalizer-band-slider__plot" aria-hidden>
        <div className="equalizer-band-slider__rail" />
        <div
          className="equalizer-band-slider__fill"
          style={{
            bottom: `${fillBottom}%`,
            height: `${fillHeight}%`,
          }}
        />
        <div
          className="equalizer-band-slider__thumb"
          style={{ bottom: `${ratio * 100}%` }}
        />
      </div>
      <Slider
        className="equalizer-band-slider__input"
        wrapperClassName="equalizer-band-slider__input-wrap"
        aria-label={ariaLabel}
        min={EQ_GAIN_MIN}
        max={EQ_GAIN_MAX}
        step="any"
        value={value}
        disabled={disabled}
        showValueTooltip={showValueTooltip}
        valueTooltipAxis="vertical"
        valueTooltipSide="before"
        formatValueTooltip={formatEqGainDb}
        onChange={(event) =>
          onChange(snapBandGainNearZero(Number(event.currentTarget.value)))
        }
      />
    </div>
  );
}

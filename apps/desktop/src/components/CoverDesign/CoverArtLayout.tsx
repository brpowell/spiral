import type { CSSProperties, ReactNode } from "react";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/common/RadioGroup/RadioGroup";
import "./CoverArtLayout.css";

export interface CoverArtOption<Mode extends string> {
  value: Mode;
  label: string;
  /** Small preview of this mode, drawn inside its card. */
  thumb: ReactNode;
}

interface CoverArtLayoutProps<Mode extends string> {
  /** The live cover, drawn large beside the controls. */
  preview: ReactNode;
  /** Shown just under the preview, such as a reset button. */
  previewFooter?: ReactNode;
  name: string;
  ariaLabel: string;
  value: Mode;
  onChange: (mode: Mode) => void;
  options: CoverArtOption<Mode>[];
  /**
   * Controls for each mode. Every one stays laid out, with the inactive ones
   * `inert`, so the tab keeps the height of the tallest option.
   */
  children?: ReactNode;
}

/**
 * The Art tab of a cover editor: a large preview, a row of mode cards, and the
 * controls for the selected mode. Shared by the playlist and genre editors.
 */
export function CoverArtLayout<Mode extends string>({
  preview,
  previewFooter,
  name,
  ariaLabel,
  value,
  onChange,
  options,
  children,
}: CoverArtLayoutProps<Mode>) {
  return (
    <div className="cover-art">
      <div className="cover-art__preview">
        <div className="cover-art__preview-art">{preview}</div>
        {previewFooter}
      </div>

      <div
        className="cover-art__controls"
        style={{ "--cover-art-modes": options.length } as CSSProperties}
      >
        <RadioGroup
          name={name}
          value={value}
          onChange={onChange}
          variant="button"
          orientation="horizontal"
          aria-label={ariaLabel}
          className="cover-art__modes"
        >
          {options.map((option) => (
            <RadioGroupItem
              key={option.value}
              value={option.value}
              className="cover-art__mode"
            >
              <span className="cover-art__mode-thumb" aria-hidden>
                {option.thumb}
              </span>
              <span className="cover-art__mode-label">{option.label}</span>
            </RadioGroupItem>
          ))}
        </RadioGroup>

        <div className="cover-art__stage">{children}</div>
      </div>
    </div>
  );
}

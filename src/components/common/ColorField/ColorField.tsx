import {
  useId,
  type ChangeEvent,
  type ComponentPropsWithoutRef,
} from "react";
import { IconReset } from "../../icons";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "../InputGroup/InputGroup";
import "./ColorField.css";

export type ColorFieldProps = Omit<
  ComponentPropsWithoutRef<"input">,
  "type" | "value" | "onChange" | "defaultValue"
> & {
  value: string;
  onChange: (value: string) => void;
  /** Label announced for the swatch / native color picker. */
  swatchLabel?: string;
  /**
   * When provided, shows a trailing reset button inside the text control.
   * Callers typically pass this only when the value is dirty vs a baseline.
   */
  onReset?: () => void;
  /** Accessible label for the reset button. */
  resetLabel?: string;
};

/** Best-effort parse of a CSS color string into `#rrggbb` for `<input type="color">`. */
export function cssColorToHex(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const hex3 = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (hex3) {
    const [r, g, b] = hex3[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }

  const hex6 = /^#([0-9a-f]{6})$/i.exec(trimmed);
  if (hex6) return `#${hex6[1]}`.toLowerCase();

  const hex8 = /^#([0-9a-f]{8})$/i.exec(trimmed);
  if (hex8) return `#${hex8[1].slice(0, 6)}`.toLowerCase();

  if (typeof document === "undefined") return null;
  const el = document.createElement("div");
  el.style.color = trimmed;
  document.body.appendChild(el);
  const computed = getComputedStyle(el).color;
  document.body.removeChild(el);
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(computed);
  if (!rgb) return null;
  const toHex = (n: string) =>
    Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0");
  return `#${toHex(rgb[1])}${toHex(rgb[2])}${toHex(rgb[3])}`;
}

export function ColorField({
  value,
  onChange,
  className,
  id: idProp,
  swatchLabel = "Open color picker",
  onReset,
  resetLabel = "Reset to original",
  disabled,
  ...props
}: ColorFieldProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const pickerHex = cssColorToHex(value) ?? "#808080";

  const handleTextChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  const handlePickerChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  return (
    <div className={["color-field", className].filter(Boolean).join(" ")}>
      <label
        className={[
          "color-field__swatch",
          disabled ? "color-field__swatch--disabled" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ background: value || "transparent" }}
        title={swatchLabel}
      >
        <span className="color-field__swatch-label">{swatchLabel}</span>
        <input
          type="color"
          className="color-field__native"
          value={pickerHex}
          disabled={disabled}
          onChange={handlePickerChange}
        />
      </label>
      <InputGroup className="color-field__control" disabled={disabled}>
        <InputGroupInput
          {...props}
          id={id}
          value={value}
          disabled={disabled}
          onChange={handleTextChange}
          spellCheck={false}
          autoComplete="off"
        />
        {onReset != null ? (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              aria-label={resetLabel}
              disabled={disabled}
              onClick={onReset}
            >
              <IconReset />
            </InputGroupButton>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </div>
  );
}

import type { ReactNode } from "react";
import { IconChevronDown } from "../../icons";
import type { SelectBaseProps } from "../Select/selectTypes";
import "./NativeSelect.css";

export type NativeSelectProps<T extends string> = SelectBaseProps<T>;

function optionLabel(label: ReactNode): string {
  if (typeof label === "string" || typeof label === "number") {
    return String(label);
  }
  return "";
}

export function NativeSelect<T extends string>({
  value,
  onChange,
  options,
  "aria-label": ariaLabel,
  className,
  disabled = false,
}: NativeSelectProps<T>) {
  return (
    <div
      className={["native-select-wrap", className, disabled && "native-select-wrap--disabled"]
        .filter(Boolean)
        .join(" ")}
    >
      <select
        className="native-select"
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {optionLabel(option.label) || option.value}
          </option>
        ))}
      </select>
      <span className="native-select__chevron" aria-hidden>
        <IconChevronDown />
      </span>
    </div>
  );
}

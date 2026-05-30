import type { ReactNode } from "react";
import "./RadioGroup.css";

export type RadioGroupOrientation = "horizontal" | "vertical";
export type RadioGroupOptionVariant = "plain" | "card";

export type RadioGroupOption<T extends string> = {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
};

export type RadioGroupProps<T extends string> = {
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: RadioGroupOption<T>[];
  orientation?: RadioGroupOrientation;
  optionVariant?: RadioGroupOptionVariant;
  legend?: ReactNode;
  "aria-label"?: string;
  className?: string;
};

export function RadioGroup<T extends string>({
  name,
  value,
  onChange,
  options,
  orientation = "horizontal",
  optionVariant = "plain",
  legend,
  "aria-label": ariaLabel,
  className,
}: RadioGroupProps<T>) {
  const rootClass = [
    "radio-group",
    `radio-group--${orientation}`,
    `radio-group--${optionVariant}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <fieldset className={rootClass} aria-label={legend ? undefined : ariaLabel}>
      {legend ? <legend className="radio-group__legend">{legend}</legend> : null}
      <div className="radio-group__options">
        {options.map((opt) => {
          const id = `${name}-${opt.value}`;
          const checked = value === opt.value;
          return (
            <label
              key={opt.value}
              htmlFor={id}
              className={[
                "radio-group__option",
                optionVariant === "card" && "radio-group__option--card",
                checked && "radio-group__option--checked",
                opt.disabled && "radio-group__option--disabled",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <input
                id={id}
                type="radio"
                className="radio-group__input"
                name={name}
                value={opt.value}
                checked={checked}
                disabled={opt.disabled}
                onChange={() => onChange(opt.value)}
              />
              <span className="radio-group__label">{opt.label}</span>
              {opt.description ? (
                <span className="radio-group__description">{opt.description}</span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

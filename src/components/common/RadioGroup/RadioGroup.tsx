import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import "./RadioGroup.css";

export type RadioGroupOrientation = "horizontal" | "vertical";
export type RadioGroupVariant = "default" | "button";

type RadioGroupContextValue<T extends string = string> = {
  name: string;
  value: T;
  onChange: (value: T) => void;
  disabled: boolean;
  variant: RadioGroupVariant;
};

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

function useRadioGroupContext() {
  const context = useContext(RadioGroupContext);
  if (context == null) {
    throw new Error("RadioGroupItem must be used within a RadioGroup");
  }
  return context;
}

export type RadioGroupProps<T extends string> = {
  name?: string;
  value: T;
  onChange: (value: T) => void;
  orientation?: RadioGroupOrientation;
  variant?: RadioGroupVariant;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  className?: string;
  children: ReactNode;
};

export function RadioGroup<T extends string>({
  name: nameProp,
  value,
  onChange,
  orientation = "horizontal",
  variant = "default",
  disabled = false,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  className,
  children,
}: RadioGroupProps<T>) {
  const autoName = useId();
  const name = nameProp ?? autoName;

  const rootClass = [
    "radio-group",
    `radio-group--${orientation}`,
    `radio-group--${variant}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <RadioGroupContext.Provider
      value={{
        name,
        value,
        onChange: onChange as (value: string) => void,
        disabled,
        variant,
      }}
    >
      <div
        role="radiogroup"
        className={rootClass}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
      >
        {children}
      </div>
    </RadioGroupContext.Provider>
  );
}

export type RadioGroupItemProps = Omit<
  ComponentPropsWithoutRef<"input">,
  "type" | "name" | "checked" | "onChange" | "children"
> & {
  value: string;
  children?: ReactNode;
};

export const RadioGroupItem = forwardRef<HTMLInputElement, RadioGroupItemProps>(
  function RadioGroupItem(
    { value, id: idProp, disabled, className, title, children, ...props },
    ref,
  ) {
    const {
      name,
      value: groupValue,
      onChange,
      disabled: groupDisabled,
      variant,
    } = useRadioGroupContext();
    const autoId = useId();
    const id = idProp ?? autoId;
    const isDisabled = disabled ?? groupDisabled;
    const checked = groupValue === value;

    const input = (
      <input
        ref={ref}
        id={id}
        type="radio"
        className={
          variant === "button"
            ? "radio-group-item__input radio-group-item__input--visually-hidden"
            : ["radio-group-item__input", className].filter(Boolean).join(" ")
        }
        name={name}
        value={value}
        checked={checked}
        disabled={isDisabled}
        onChange={() => onChange(value)}
        title={variant === "button" ? undefined : title}
        {...props}
      />
    );

    if (variant === "button") {
      const labelClass = [
        "radio-group-item",
        "radio-group-item--button",
        checked && "radio-group-item--checked",
        isDisabled && "radio-group-item--disabled",
        className,
      ]
        .filter(Boolean)
        .join(" ");

      return (
        <label className={labelClass} title={title}>
          {input}
          {children}
        </label>
      );
    }

    return input;
  },
);

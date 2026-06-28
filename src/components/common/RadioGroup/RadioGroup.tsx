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

type RadioGroupContextValue<T extends string = string> = {
  name: string;
  value: T;
  onChange: (value: T) => void;
  disabled: boolean;
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
  "type" | "name" | "checked" | "onChange"
> & {
  value: string;
};

export const RadioGroupItem = forwardRef<HTMLInputElement, RadioGroupItemProps>(
  function RadioGroupItem(
    { value, id: idProp, disabled, className, ...props },
    ref,
  ) {
    const { name, value: groupValue, onChange, disabled: groupDisabled } =
      useRadioGroupContext();
    const autoId = useId();
    const id = idProp ?? autoId;
    const isDisabled = disabled ?? groupDisabled;

    const inputClass = ["radio-group-item__input", className]
      .filter(Boolean)
      .join(" ");

    return (
      <input
        ref={ref}
        id={id}
        type="radio"
        className={inputClass}
        name={name}
        value={value}
        checked={groupValue === value}
        disabled={isDisabled}
        onChange={() => onChange(value)}
        {...props}
      />
    );
  },
);

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
/**
 * `default`: native radio dots. `button`: a row of small toggle buttons.
 * `card`: stacked option cards with an icon, title and description.
 */
export type RadioGroupVariant = "default" | "button" | "card";

type RadioGroupContextValue<T extends string = string> = {
  name: string;
  value: T | null;
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
  /** The checked item's value; null when none is picked yet. */
  value: T | null;
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
  /** The option's label (its title, for the `card` variant). */
  children?: ReactNode;
  /** `card` only: leading icon. */
  icon?: ReactNode;
  /** `card` only: a quieter line under the title, read as the description. */
  description?: ReactNode;
};

export const RadioGroupItem = forwardRef<HTMLInputElement, RadioGroupItemProps>(
  function RadioGroupItem(
    {
      value,
      id: idProp,
      disabled,
      className,
      title,
      children,
      icon,
      description,
      ...props
    },
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
    const isCard = variant === "card";
    const hidden = variant === "button" || isCard;
    const isDisabled = disabled ?? groupDisabled;
    const checked = groupValue === value;

    const input = (
      <input
        ref={ref}
        id={id}
        type="radio"
        className={
          hidden
            ? "radio-group-item__input radio-group-item__input--visually-hidden"
            : ["radio-group-item__input", className].filter(Boolean).join(" ")
        }
        name={name}
        value={value}
        checked={checked}
        disabled={isDisabled}
        onChange={() => onChange(value)}
        title={hidden ? undefined : title}
        // The card's label wraps its description too; name it by the title alone.
        aria-labelledby={isCard ? `${id}-title` : undefined}
        aria-describedby={
          isCard && description ? `${id}-description` : undefined
        }
        {...props}
      />
    );

    if (isCard) {
      const cardClass = [
        "radio-group-item",
        "radio-group-item--card",
        checked && "radio-group-item--checked",
        isDisabled && "radio-group-item--disabled",
        className,
      ]
        .filter(Boolean)
        .join(" ");

      return (
        <label className={cardClass} title={title}>
          {input}
          {icon != null ? (
            <span className="radio-group-item__icon" aria-hidden="true">
              {icon}
            </span>
          ) : null}
          <span className="radio-group-item__text">
            <span id={`${id}-title`} className="radio-group-item__title">
              {children}
            </span>
            {description != null ? (
              <span
                id={`${id}-description`}
                className="radio-group-item__description"
              >
                {description}
              </span>
            ) : null}
          </span>
        </label>
      );
    }

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

import {
  forwardRef,
  useId,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import "./Checkbox.css";

export type CheckboxVariant = "default" | "muted";

export type CheckboxProps = Omit<
  ComponentPropsWithoutRef<"input">,
  "type" | "children"
> & {
  children?: ReactNode;
  variant?: CheckboxVariant;
  alignStart?: boolean;
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox(
    {
      children,
      className,
      id: idProp,
      variant = "default",
      alignStart = false,
      disabled,
      ...props
    },
    ref,
  ) {
    const autoId = useId();
    const id = idProp ?? autoId;

    const rootClass = [
      "checkbox",
      variant === "muted" && "checkbox--muted",
      alignStart && "checkbox--align-start",
      disabled && "checkbox--disabled",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    if (children == null) {
      return (
        <input
          ref={ref}
          id={id}
          type="checkbox"
          className="checkbox__input"
          disabled={disabled}
          {...props}
        />
      );
    }

    return (
      <label className={rootClass} htmlFor={id}>
        <input
          ref={ref}
          id={id}
          type="checkbox"
          className="checkbox__input"
          disabled={disabled}
          {...props}
        />
        <span className="checkbox__label">{children}</span>
      </label>
    );
  },
);

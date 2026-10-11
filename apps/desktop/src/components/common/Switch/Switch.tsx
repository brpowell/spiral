import {
  forwardRef,
  useId,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import "./Switch.css";

export type SwitchVariant = "default" | "muted";

export type SwitchProps = Omit<
  ComponentPropsWithoutRef<"input">,
  "type" | "children" | "role"
> & {
  children?: ReactNode;
  variant?: SwitchVariant;
  alignStart?: boolean;
};

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
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
    "switch",
    variant === "muted" && "switch--muted",
    alignStart && "switch--align-start",
    disabled && "switch--disabled",
    children == null && "switch--bare",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const control = (
    <span className="switch__control">
      <input
        ref={ref}
        id={id}
        type="checkbox"
        role="switch"
        className="switch__input"
        disabled={disabled}
        {...props}
      />
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
    </span>
  );

  if (children == null) {
    return <span className={rootClass}>{control}</span>;
  }

  return (
    <label className={rootClass} htmlFor={id}>
      {control}
      <span className="switch__label">{children}</span>
    </label>
  );
});

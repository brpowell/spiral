import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type MouseEvent,
} from "react";
import { Button, type ButtonProps } from "../Button/Button";
import { TextInput, type TextInputProps } from "../TextInput/TextInput";
import "./InputGroup.css";

export type InputGroupProps = ComponentPropsWithoutRef<"div"> & {
  disabled?: boolean;
};

/** Bordered control shell that hosts a ghost input plus leading/trailing addons. */
export function InputGroup({
  className,
  disabled,
  onClick,
  children,
  ...props
}: InputGroupProps) {
  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    if ((e.target as HTMLElement).closest("button, a, input, textarea")) return;
    e.currentTarget
      .querySelector<HTMLElement>("[data-slot='input-group-control']")
      ?.focus();
  };

  return (
    <div
      role="group"
      data-disabled={disabled ? "true" : undefined}
      className={["input-group", className].filter(Boolean).join(" ")}
      onClick={handleClick}
      {...props}
    >
      {children}
    </div>
  );
}

export type InputGroupAddonAlign = "inline-start" | "inline-end";

export type InputGroupAddonProps = ComponentPropsWithoutRef<"div"> & {
  align?: InputGroupAddonAlign;
};

/**
 * Leading/trailing slot for icons or buttons.
 * Place after the control in the DOM (focus order); use `align` for visual position.
 */
export function InputGroupAddon({
  className,
  align = "inline-start",
  onClick,
  children,
  ...props
}: InputGroupAddonProps) {
  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    if ((e.target as HTMLElement).closest("button, a")) return;
    e.currentTarget.parentElement
      ?.querySelector<HTMLElement>("[data-slot='input-group-control']")
      ?.focus();
  };

  return (
    <div
      data-slot="input-group-addon"
      data-align={align}
      className={[
        "input-group__addon",
        `input-group__addon--${align}`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={handleClick}
      {...props}
    >
      {children}
    </div>
  );
}

export type InputGroupButtonProps = Omit<ButtonProps, "variant" | "size"> & {
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
};

/** Compact ghost icon button sized for use inside an InputGroup addon. */
export const InputGroupButton = forwardRef<
  HTMLButtonElement,
  InputGroupButtonProps
>(function InputGroupButton(
  {
    className,
    variant = "ghost",
    size = "sm",
    iconOnly = true,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <Button
      ref={ref}
      type={type}
      variant={variant}
      size={size}
      iconOnly={iconOnly}
      className={["input-group__button", className].filter(Boolean).join(" ")}
      {...props}
    />
  );
});

export type InputGroupInputProps = TextInputProps;

/** Ghost TextInput that participates in the InputGroup focus/layout contract. */
export const InputGroupInput = forwardRef<
  HTMLInputElement,
  InputGroupInputProps
>(function InputGroupInput({ className, variant = "ghost", ...props }, ref) {
  return (
    <TextInput
      ref={ref}
      variant={variant}
      data-slot="input-group-control"
      className={["input-group__input", className].filter(Boolean).join(" ")}
      {...props}
    />
  );
});

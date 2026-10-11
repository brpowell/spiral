import { forwardRef, type ComponentPropsWithoutRef } from "react";
import "./Button.css";

export type ButtonVariant =
  "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

export type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  /** Shows a spinner and disables the button while work is in flight. */
  isLoading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "secondary",
      size = "md",
      iconOnly = false,
      isLoading = false,
      className,
      type = "button",
      disabled,
      children,
      ...props
    },
    ref,
  ) {
    const classes = [
      "btn",
      `btn--${variant}`,
      `btn--${size}`,
      iconOnly && "btn--icon-only",
      isLoading && "btn--loading",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <button
        ref={ref}
        type={type}
        className={classes}
        disabled={disabled || isLoading}
        aria-busy={isLoading || undefined}
        {...props}
      >
        {isLoading ? <span className="btn__spinner" aria-hidden /> : null}
        {children}
      </button>
    );
  },
);

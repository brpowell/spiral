import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import "./Button.css";

export type ButtonVariant =
  "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

export type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  /**
   * Shows a spinner in place of any icon and disables the button while work
   * is in flight.
   */
  isLoading?: boolean;
  /** Replaces the button's content while `isLoading`, e.g. "Adding…". */
  loadingLabel?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "secondary",
      size = "md",
      iconOnly = false,
      isLoading = false,
      loadingLabel,
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
        {isLoading && loadingLabel != null ? loadingLabel : children}
      </button>
    );
  },
);

import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type HTMLAttributes,
} from "react";
import "./ButtonGroup.css";

export type ButtonGroupOrientation = "horizontal" | "vertical";

export type ButtonGroupProps = ComponentPropsWithoutRef<"div"> & {
  orientation?: ButtonGroupOrientation;
};

/** Groups related buttons with shared borders / radius (split buttons, toolbars). */
export const ButtonGroup = forwardRef<HTMLDivElement, ButtonGroupProps>(
  function ButtonGroup(
    { orientation = "horizontal", className, children, ...props },
    ref,
  ) {
    return (
      <div
        ref={ref}
        role="group"
        data-orientation={orientation}
        className={["button-group", className].filter(Boolean).join(" ")}
        {...props}
      >
        {children}
      </div>
    );
  },
);

export type ButtonGroupSeparatorProps = HTMLAttributes<HTMLDivElement> & {
  orientation?: ButtonGroupOrientation;
};

/** Visual divider between buttons in a group (recommended for non-outline variants). */
export function ButtonGroupSeparator({
  orientation = "vertical",
  className,
  ...props
}: ButtonGroupSeparatorProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      data-orientation={orientation}
      className={["button-group__separator", className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}

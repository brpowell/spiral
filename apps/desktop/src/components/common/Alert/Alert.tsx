import type { ComponentPropsWithoutRef, ReactNode } from "react";
import "./Alert.css";

export type AlertVariant = "info" | "success" | "warning" | "error";

export type AlertProps = Omit<ComponentPropsWithoutRef<"div">, "role"> & {
  variant?: AlertVariant;
  children: ReactNode;
  /** Decorative leading icon; inherits the variant colour. */
  icon?: ReactNode;
  role?: "alert" | "status";
};

function defaultRole(variant: AlertVariant): "alert" | "status" {
  return variant === "error" || variant === "warning" ? "alert" : "status";
}

export function Alert({
  variant = "info",
  className,
  children,
  icon,
  role,
  ...props
}: AlertProps) {
  const classes = [
    "alert",
    `alert--${variant}`,
    icon != null && "alert--with-icon",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} role={role ?? defaultRole(variant)} {...props}>
      {icon != null ? (
        <>
          <span className="alert__icon" aria-hidden>
            {icon}
          </span>
          <div className="alert__content">{children}</div>
        </>
      ) : (
        children
      )}
    </div>
  );
}

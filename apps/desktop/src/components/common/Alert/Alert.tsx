import type { ComponentPropsWithoutRef, ReactNode } from "react";
import "./Alert.css";

export type AlertVariant = "info" | "success" | "warning" | "error";

export type AlertProps = Omit<ComponentPropsWithoutRef<"div">, "role"> & {
  variant?: AlertVariant;
  children: ReactNode;
  role?: "alert" | "status";
};

function defaultRole(variant: AlertVariant): "alert" | "status" {
  return variant === "error" || variant === "warning" ? "alert" : "status";
}

export function Alert({
  variant = "info",
  className,
  children,
  role,
  ...props
}: AlertProps) {
  const classes = ["alert", `alert--${variant}`, className].filter(Boolean).join(" ");

  return (
    <div
      className={classes}
      role={role ?? defaultRole(variant)}
      {...props}
    >
      {children}
    </div>
  );
}

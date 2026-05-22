import type { ComponentPropsWithoutRef, ReactNode } from "react";
import "./Field.css";

export type FieldProps = ComponentPropsWithoutRef<"label">;

export function Field({ className, children, ...props }: FieldProps) {
  const classes = ["field", className].filter(Boolean).join(" ");
  return (
    <label className={classes} {...props}>
      {children}
    </label>
  );
}

export type FieldLabelProps = ComponentPropsWithoutRef<"span">;

export function FieldLabel({ className, children, ...props }: FieldLabelProps) {
  const classes = ["field__label", className].filter(Boolean).join(" ");
  return (
    <span className={classes} {...props}>
      {children}
    </span>
  );
}

export type FormFieldProps = {
  label: ReactNode;
  children: ReactNode;
  className?: string;
};

export function FormField({ label, children, className }: FormFieldProps) {
  return (
    <Field className={className}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </Field>
  );
}

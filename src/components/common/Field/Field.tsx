import { useId, type ComponentPropsWithoutRef, type ReactNode } from "react";
import "./Field.css";

export type FieldOrientation = "vertical" | "horizontal";

export type FieldProps = ComponentPropsWithoutRef<"div"> & {
  orientation?: FieldOrientation;
};

export function Field({
  className,
  children,
  orientation = "vertical",
  ...props
}: FieldProps) {
  const classes = [
    "field",
    orientation === "horizontal" && "field--horizontal",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} {...props}>
      {children}
    </div>
  );
}

export type FieldLabelProps = ComponentPropsWithoutRef<"span"> & {
  htmlFor?: string;
  /** Visually hide the label while keeping it available to assistive tech. */
  srOnly?: boolean;
};

export function FieldLabel({
  className,
  children,
  htmlFor,
  srOnly = false,
  ...props
}: FieldLabelProps) {
  const classes = ["field__label", srOnly && "field__label--sr-only", className]
    .filter(Boolean)
    .join(" ");

  if (htmlFor != null) {
    return (
      <label className={classes} htmlFor={htmlFor} {...props}>
        {children}
      </label>
    );
  }

  return (
    <span className={classes} {...props}>
      {children}
    </span>
  );
}

export type FieldContentProps = ComponentPropsWithoutRef<"div">;

export function FieldContent({
  className,
  children,
  ...props
}: FieldContentProps) {
  const classes = ["field__content", className].filter(Boolean).join(" ");
  return (
    <div className={classes} {...props}>
      {children}
    </div>
  );
}

export type FieldDescriptionProps = ComponentPropsWithoutRef<"span">;

export function FieldDescription({
  className,
  children,
  ...props
}: FieldDescriptionProps) {
  const classes = ["field__description", className].filter(Boolean).join(" ");
  return (
    <span className={classes} {...props}>
      {children}
    </span>
  );
}

export type FieldErrorProps = ComponentPropsWithoutRef<"span">;

/** Inline validation / field-level error under a control. */
export function FieldError({ className, children, ...props }: FieldErrorProps) {
  if (children == null || children === false) return null;
  const classes = ["field__error", className].filter(Boolean).join(" ");
  return (
    <span className={classes} role="alert" {...props}>
      {children}
    </span>
  );
}

export type FormFieldDescriptionPosition = "below-label" | "below-control";

export type FormFieldProps = {
  label: ReactNode;
  description?: ReactNode;
  descriptionPosition?: FormFieldDescriptionPosition;
  /** Field-level validation error shown below the control. */
  error?: ReactNode;
  children: ReactNode;
  className?: string;
  labelId?: string;
  /** Visually hide the label while keeping it available to assistive tech. */
  srOnly?: boolean;
};

export function FormField({
  label,
  description,
  descriptionPosition = "below-control",
  error,
  children,
  className,
  labelId: labelIdProp,
  srOnly = false,
}: FormFieldProps) {
  const autoLabelId = useId();
  const labelId = labelIdProp ?? autoLabelId;
  const descriptionNode =
    description != null ? (
      <FieldDescription>{description}</FieldDescription>
    ) : null;

  return (
    <div
      className={[
        "field",
        description != null &&
          descriptionPosition === "below-label" &&
          "field--description-below-label",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <FieldLabel id={labelId} srOnly={srOnly}>
        {label}
      </FieldLabel>
      {descriptionPosition === "below-label" ? descriptionNode : null}
      {children}
      {descriptionPosition === "below-control" ? descriptionNode : null}
      {error != null ? <FieldError>{error}</FieldError> : null}
    </div>
  );
}

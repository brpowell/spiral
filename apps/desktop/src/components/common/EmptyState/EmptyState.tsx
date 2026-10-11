import type { ComponentPropsWithoutRef, ReactNode } from "react";
import "./EmptyState.css";

export type EmptyStateProps = ComponentPropsWithoutRef<"div"> & {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  const classes = ["empty-state", className].filter(Boolean).join(" ");

  return (
    <div className={classes} {...props}>
      {icon ? (
        <div className="empty-state__icon" aria-hidden>
          {icon}
        </div>
      ) : null}
      <p className="empty-state__title">{title}</p>
      {description ? (
        <p className="empty-state__description">{description}</p>
      ) : null}
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}

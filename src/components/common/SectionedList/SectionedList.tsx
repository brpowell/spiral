import type { ReactNode } from "react";
import "./SectionedList.css";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function SectionedList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("sectioned-list", className)}>{children}</div>
  );
}

export function SectionedListGroup({
  title,
  icon,
  count,
  children,
  className,
}: {
  title: ReactNode;
  icon?: ReactNode;
  /** Plain secondary total, matching browse/detail header counts. */
  count?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("sectioned-list__group", className)}>
      <h4 className="sectioned-list__title">
        {icon != null ? (
          <span className="sectioned-list__title-icon" aria-hidden>
            {icon}
          </span>
        ) : null}
        <span className="sectioned-list__title-text">{title}</span>
        {count != null ? (
          <span className="sectioned-list__title-count">({count})</span>
        ) : null}
      </h4>
      {children}
    </section>
  );
}

export function SectionedListItems({
  children,
  className,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <ul
      className={cx("sectioned-list__items", className)}
      aria-label={ariaLabel}
    >
      {children}
    </ul>
  );
}

export function SectionedListItem({
  leading,
  children,
  actions,
  onSelect,
  className,
  "aria-label": ariaLabel,
}: {
  leading?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  onSelect?: () => void;
  className?: string;
  "aria-label"?: string;
}) {
  const mainClass = "sectioned-list__item-main";
  const body = (
    <>
      {leading}
      <div className="sectioned-list__item-body">{children}</div>
    </>
  );

  return (
    <li className={cx("sectioned-list__item", className)}>
      {onSelect ? (
        <button
          type="button"
          className={mainClass}
          onClick={onSelect}
          aria-label={ariaLabel}
        >
          {body}
        </button>
      ) : (
        <div className={mainClass}>{body}</div>
      )}
      {actions != null ? (
        <div className="sectioned-list__item-actions">{actions}</div>
      ) : null}
    </li>
  );
}

export function SectionedListItemTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cx("sectioned-list__item-title", className)}>
      {children}
    </span>
  );
}

export function SectionedListItemSubtitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cx("sectioned-list__item-subtitle", className)}>
      {children}
    </span>
  );
}

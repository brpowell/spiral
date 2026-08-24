import type { ComponentPropsWithoutRef, ReactNode } from "react";
import "./ChoiceOption.css";

export type ChoiceListProps = ComponentPropsWithoutRef<"ul">;

/** Stacked list of {@link ChoiceOption} rows (renders a `<ul>`). */
export function ChoiceList({ className, children, ...props }: ChoiceListProps) {
  const classes = ["choice-list", className].filter(Boolean).join(" ");
  return (
    <ul className={classes} {...props}>
      {children}
    </ul>
  );
}

export type ChoiceOptionProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "children" | "type"
> & {
  title: ReactNode;
  /** Secondary line under the title (album, release details, etc.). */
  details?: ReactNode;
  /** Trailing meta (count, duration, badges). Stacked top-right when multiple. */
  meta?: ReactNode;
  /** Marks this row as the currently chosen option. */
  selected?: boolean;
};

/**
 * Selectable row for “pick one of these” surfaces (disc matching, lyrics
 * candidates, and similar). Raised surface, transparent border, accent hover.
 */
export function ChoiceOption({
  title,
  details,
  meta,
  selected = false,
  className,
  ...props
}: ChoiceOptionProps) {
  const classes = [
    "choice-option",
    selected ? "choice-option--selected" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classes}
      {...props}
      aria-pressed={selected ? true : undefined}
    >
      <span className="choice-option__main">
        <span className="choice-option__title">{title}</span>
        {details != null ? (
          <span className="choice-option__details">{details}</span>
        ) : null}
      </span>
      {meta != null ? (
        <span className="choice-option__meta">{meta}</span>
      ) : null}
    </button>
  );
}

import type { ReactNode } from "react";
import {
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../../ContextMenu/ContextMenu";
import { IconListX } from "../../icons";
import { SelectShell } from "./SelectShell";
import type { SelectOption } from "./selectTypes";

export type MultiSelectProps<T extends string> = {
  /** Checked values; none checked means "no filter". */
  values: T[];
  onChange: (values: T[]) => void;
  options: SelectOption<T>[];
  /** What the trigger shows for the current selection (none, one, or several). */
  summary: ReactNode;
  /** Adds a "clear" entry below the options while anything is checked. */
  clearLabel?: string;
  "aria-label": string;
  className?: string;
  disabled?: boolean;
};

/**
 * A {@link Select} that allows several values. Same trigger and menu; entries are checkboxes
 * and the menu stays open while you toggle them.
 */
export function MultiSelect<T extends string>({
  values,
  onChange,
  options,
  summary,
  clearLabel,
  "aria-label": ariaLabel,
  className,
  disabled = false,
}: MultiSelectProps<T>) {
  const toggle = (value: T) =>
    onChange(
      values.includes(value)
        ? values.filter((v) => v !== value)
        : [...values, value],
    );

  return (
    <SelectShell
      value={summary}
      aria-label={ariaLabel}
      className={className}
      disabled={disabled}
      layoutDeps={[options, values]}
    >
      {(close) => (
        <>
          {options.map((opt) => (
            <ContextMenuCheckboxItem
              key={opt.value}
              icon={opt.icon}
              label={opt.label}
              checked={values.includes(opt.value)}
              disabled={opt.disabled}
              onClick={() => toggle(opt.value)}
            />
          ))}
          {clearLabel && values.length > 0 ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                icon={<IconListX />}
                label={clearLabel}
                onClick={() => {
                  close();
                  onChange([]);
                }}
              />
            </>
          ) : null}
        </>
      )}
    </SelectShell>
  );
}

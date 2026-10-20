import type { ReactNode } from "react";

export type SelectOption<T extends string> = {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  /** Shown before the label in multi-selects. */
  icon?: ReactNode;
  disabled?: boolean;
  /** Single selects only: a heading is shown above the first option of each run of equal groups. */
  group?: ReactNode;
};

export type SelectBaseProps<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  /** Shown before the value on the trigger (a hint of what the select is for). */
  icon?: ReactNode;
  "aria-label": string;
  className?: string;
  disabled?: boolean;
};

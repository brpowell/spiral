import type { ReactNode } from "react";

export type SelectOption<T extends string> = {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  /** Shown before the label in multi-selects. */
  icon?: ReactNode;
  disabled?: boolean;
};

export type SelectBaseProps<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  "aria-label": string;
  className?: string;
  disabled?: boolean;
};

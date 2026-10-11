import type { ReactNode } from "react";

export type SelectOption<T extends string> = {
  value: T;
  label: ReactNode;
  description?: ReactNode;
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

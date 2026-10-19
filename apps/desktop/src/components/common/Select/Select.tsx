import { ContextMenuOptionItem } from "../../ContextMenu/ContextMenu";
import { SelectShell } from "./SelectShell";
import type { SelectBaseProps } from "./selectTypes";

export type { SelectOption } from "./selectTypes";

export type SelectProps<T extends string> = SelectBaseProps<T>;

export function Select<T extends string>({
  value,
  onChange,
  options,
  "aria-label": ariaLabel,
  className,
  disabled = false,
}: SelectProps<T>) {
  const selected = options.find((o) => o.value === value);

  return (
    <SelectShell
      value={selected?.label ?? "Select…"}
      aria-label={ariaLabel}
      className={className}
      disabled={disabled}
      layoutDeps={[options, value]}
    >
      {(close) =>
        options.map((opt) => (
          <ContextMenuOptionItem
            key={opt.value}
            label={opt.label}
            description={opt.description}
            selected={value === opt.value}
            disabled={opt.disabled}
            onClick={() => {
              if (!opt.disabled && opt.value !== value) {
                onChange(opt.value);
              }
              close();
            }}
          />
        ))
      }
    </SelectShell>
  );
}

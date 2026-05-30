import { useRef, type ReactNode } from "react";
import { useContextMenu } from "../../../hooks/useContextMenu";
import {
  ContextMenu,
  ContextMenuOptionItem,
} from "../../ContextMenu/ContextMenu";
import { IconChevronDown } from "../../icons";
import "./Select.css";

export type SelectOption<T extends string> = {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
};

export type SelectProps<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  "aria-label": string;
  className?: string;
  disabled?: boolean;
};

export function Select<T extends string>({
  value,
  onChange,
  options,
  "aria-label": ariaLabel,
  className,
  disabled = false,
}: SelectProps<T>) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { open, anchor, position, menuRef, toggleFromTrigger, closeMenu } =
    useContextMenu({
      layoutDeps: [options, value],
      dismissExcludeRefs: [triggerRef],
      triggerPlacement: "below-start",
    });

  const selected = options.find((o) => o.value === value);

  return (
    <div className={["select", className].filter(Boolean).join(" ")}>
      <button
        ref={triggerRef}
        type="button"
        className="select__trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (!disabled) toggleFromTrigger(triggerRef.current);
        }}
      >
        <span className="select__value">
          {selected?.label ?? "Select…"}
        </span>
        <span className="select__chevron" aria-hidden>
          <IconChevronDown />
        </span>
      </button>
      <ContextMenu
        open={open}
        anchor={anchor}
        position={position}
        menuRef={menuRef}
        className="context-menu--select"
      >
        {options.map((opt) => (
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
              closeMenu();
            }}
          />
        ))}
      </ContextMenu>
    </div>
  );
}

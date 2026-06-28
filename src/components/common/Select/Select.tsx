import { useLayoutEffect, useRef, useState } from "react";
import { useContextMenu } from "../../../hooks/useContextMenu";
import {
  ContextMenu,
  ContextMenuOptionItem,
} from "../../ContextMenu/ContextMenu";
import { IconChevronDown } from "../../icons";
import type { SelectBaseProps } from "./selectTypes";
import "./Select.css";

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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuWidth, setMenuWidth] = useState<number | undefined>();
  const { open, anchor, position, menuRef, toggleFromTrigger, closeMenu } =
    useContextMenu({
      layoutDeps: [options, value, menuWidth],
      dismissExcludeRefs: [triggerRef],
      triggerPlacement: "below-start",
    });

  useLayoutEffect(() => {
    if (!open) {
      setMenuWidth(undefined);
    }
  }, [open]);

  const selected = options.find((o) => o.value === value);

  const handleTriggerClick = () => {
    if (disabled) return;
    if (triggerRef.current) {
      setMenuWidth(triggerRef.current.getBoundingClientRect().width);
    }
    toggleFromTrigger(triggerRef.current);
  };

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
        onClick={handleTriggerClick}
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
        style={menuWidth != null ? { width: menuWidth } : undefined}
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

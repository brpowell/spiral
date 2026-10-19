import {
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useContextMenu } from "../../../hooks/useContextMenu";
import { ContextMenu } from "../../ContextMenu/ContextMenu";
import { Button } from "../Button/Button";
import { IconChevronDown } from "../../icons";
import "./Select.css";

/**
 * The shared look of every select: the control-height trigger with its value and chevron, and
 * a menu as wide as the trigger. {@link Select} (one value) and {@link MultiSelect} (several)
 * both render through it, so they cannot drift apart. The caller supplies the displayed value
 * and the menu entries.
 */
export function SelectShell({
  value,
  "aria-label": ariaLabel,
  className,
  disabled = false,
  layoutDeps = [],
  children,
}: {
  /** What the trigger shows. */
  value: ReactNode;
  "aria-label": string;
  className?: string;
  disabled?: boolean;
  /** Re-run viewport fit when the menu content may change size. */
  layoutDeps?: unknown[];
  /** Menu entries; receives `close` to dismiss the menu from an entry. */
  children: (close: () => void) => ReactNode;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuWidth, setMenuWidth] = useState<number | undefined>();
  const {
    open,
    anchor,
    position,
    menuRef,
    openedWithKeyboard,
    toggleFromTrigger,
    closeMenu,
  } = useContextMenu({
    layoutDeps: [...layoutDeps, menuWidth],
    dismissExcludeRefs: [triggerRef],
    triggerPlacement: "below-start",
  });

  useLayoutEffect(() => {
    if (!open) {
      setMenuWidth(undefined);
    }
  }, [open]);

  const handleTriggerClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (triggerRef.current) {
      setMenuWidth(triggerRef.current.getBoundingClientRect().width);
    }
    toggleFromTrigger(triggerRef.current, { keyboard: e.detail === 0 });
  };

  return (
    <div className={["select", className].filter(Boolean).join(" ")}>
      <Button
        ref={triggerRef}
        variant="secondary"
        size="sm"
        className="select__trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={handleTriggerClick}
      >
        <span className="select__value">{value}</span>
        <span className="select__chevron" aria-hidden>
          <IconChevronDown />
        </span>
      </Button>
      <ContextMenu
        open={open}
        anchor={anchor}
        position={position}
        menuRef={menuRef}
        focusFirstItem={openedWithKeyboard}
        className="context-menu--select"
        style={menuWidth != null ? { minWidth: menuWidth } : undefined}
      >
        {children(closeMenu)}
      </ContextMenu>
    </div>
  );
}

import { useEffect, useRef, type ReactNode } from "react";
import {
  useContextMenu,
  type ContextMenuTriggerPlacement,
} from "../../hooks/useContextMenu";
import {
  Button,
  type ButtonSize,
  type ButtonVariant,
} from "../common/Button/Button";
import { ContextMenu } from "../ContextMenu/ContextMenu";
import { IconChevronDown, IconMore } from "../icons";
import "./MenuButton.css";

export type MenuButtonChildren = ReactNode | ((close: () => void) => ReactNode);

export interface MenuButtonProps {
  /** Accessible name for the trigger button */
  ariaLabel: string;
  children: MenuButtonChildren;
  /** When set, render a text trigger instead of icon-only */
  label?: string;
  icon?: ReactNode;
  className?: string;
  triggerClassName?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  /** Re-run viewport fit when menu content size may change */
  layoutDeps?: unknown[];
  title?: string;
  /**
   * Where the menu anchors relative to the trigger (Radix/shadcn-style).
   * - `below-end` (default): opens below, right edges align
   * - `below-start`: opens below, left edges align
   * - `above-end`: opens above, right edges align
   * - `above-start`: opens above, left edges align
   */
  triggerPlacement?: ContextMenuTriggerPlacement;
  /** Called when the menu opens or closes (however it closes). */
  onOpenChange?: (open: boolean) => void;
}

export function MenuButton({
  ariaLabel,
  children,
  label,
  icon,
  className,
  triggerClassName,
  variant = "secondary",
  size = "sm",
  disabled = false,
  layoutDeps = [],
  title,
  triggerPlacement = "below-end",
  onOpenChange,
}: MenuButtonProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const {
    open,
    anchor,
    position,
    menuRef,
    openedWithKeyboard,
    toggleFromTrigger,
    closeMenu,
  } = useContextMenu({
    layoutDeps,
    dismissExcludeRefs: [triggerRef],
    triggerPlacement,
  });

  const wasOpenRef = useRef(open);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  useEffect(() => {
    if (wasOpenRef.current === open) return;
    wasOpenRef.current = open;
    onOpenChangeRef.current?.(open);
  }, [open]);

  const menuContent =
    typeof children === "function" ? children(closeMenu) : children;
  const iconOnly = label == null;

  return (
    <div className={["menu-button", className].filter(Boolean).join(" ")}>
      <Button
        ref={triggerRef}
        variant={variant}
        size={size}
        iconOnly={iconOnly}
        disabled={disabled}
        className={["menu-button__trigger", triggerClassName]
          .filter(Boolean)
          .join(" ")}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        title={title}
        onClick={(e) => {
          if (disabled) return;
          toggleFromTrigger(triggerRef.current, { keyboard: e.detail === 0 });
        }}
      >
        {iconOnly ? (
          (icon ?? <IconMore />)
        ) : (
          <>
            {label}
            {icon ?? <IconChevronDown />}
          </>
        )}
      </Button>
      <ContextMenu
        open={open}
        anchor={anchor}
        position={position}
        menuRef={menuRef}
        focusFirstItem={openedWithKeyboard}
      >
        {menuContent}
      </ContextMenu>
    </div>
  );
}

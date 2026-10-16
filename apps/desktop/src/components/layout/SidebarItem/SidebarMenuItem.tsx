import { useRef, type ReactNode } from "react";
import {
  useContextMenu,
  type ContextMenuTriggerPlacement,
} from "../../../hooks/useContextMenu";
import { ContextMenu } from "../../ContextMenu/ContextMenu";
import { SidebarItem } from "./SidebarItem";

export interface SidebarMenuItemProps {
  icon?: ReactNode;
  /** Accessible name; defaults to the visible label. */
  ariaLabel?: string;
  disabled?: boolean;
  /** Re-run viewport fit when menu content size may change. */
  layoutDeps?: unknown[];
  triggerPlacement?: ContextMenuTriggerPlacement;
  /** Visible label. */
  children: ReactNode;
  /** Menu entries; receives `close` to dismiss the menu from an item. */
  menu: ReactNode | ((close: () => void) => ReactNode);
}

/** A sidebar row that looks like a {@link SidebarItem} but opens a context menu. */
export function SidebarMenuItem({
  icon,
  ariaLabel,
  disabled = false,
  layoutDeps = [],
  triggerPlacement = "below-start",
  children,
  menu,
}: SidebarMenuItemProps) {
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

  return (
    <>
      <SidebarItem
        ref={triggerRef}
        icon={icon}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(e) => {
          if (disabled) return;
          toggleFromTrigger(triggerRef.current, { keyboard: e.detail === 0 });
        }}
      >
        {children}
      </SidebarItem>
      <ContextMenu
        open={open}
        anchor={anchor}
        position={position}
        menuRef={menuRef}
        focusFirstItem={openedWithKeyboard}
      >
        {typeof menu === "function" ? menu(closeMenu) : menu}
      </ContextMenu>
    </>
  );
}

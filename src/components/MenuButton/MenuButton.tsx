import { useRef, type ReactNode } from "react";
import { useContextMenu } from "../../hooks/useContextMenu";
import { Button, type ButtonSize, type ButtonVariant } from "../common/Button/Button";
import { ContextMenu } from "../ContextMenu/ContextMenu";
import { IconMore } from "../icons";
import "./MenuButton.css";

export type MenuButtonChildren =
  | ReactNode
  | ((close: () => void) => ReactNode);

export interface MenuButtonProps {
  /** Accessible name for the trigger button */
  ariaLabel: string;
  children: MenuButtonChildren;
  icon?: ReactNode;
  className?: string;
  triggerClassName?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Re-run viewport fit when menu content size may change */
  layoutDeps?: unknown[];
}

export function MenuButton({
  ariaLabel,
  children,
  icon = <IconMore />,
  className,
  triggerClassName,
  variant = "ghost",
  size = "sm",
  layoutDeps = [],
}: MenuButtonProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { open, anchor, position, menuRef, toggleFromTrigger, closeMenu } =
    useContextMenu({
      layoutDeps,
      dismissExcludeRefs: [triggerRef],
    });

  const menuContent =
    typeof children === "function" ? children(closeMenu) : children;

  return (
    <div className={["menu-button", className].filter(Boolean).join(" ")}>
      <Button
        ref={triggerRef}
        variant={variant}
        size={size}
        iconOnly
        className={["menu-button__trigger", triggerClassName]
          .filter(Boolean)
          .join(" ")}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => toggleFromTrigger(triggerRef.current)}
      >
        {icon}
      </Button>
      <ContextMenu
        open={open}
        anchor={anchor}
        position={position}
        menuRef={menuRef}
      >
        {menuContent}
      </ContextMenu>
    </div>
  );
}

import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type Ref,
} from "react";
import { Button, type ButtonProps } from "../../common/Button/Button";
import "./SidebarItem.css";

export type SidebarItemVariant = "nav" | "playlist";

type SidebarItemShared = {
  active?: boolean;
  variant?: SidebarItemVariant;
  icon?: ReactNode;
  leading?: ReactNode;
  className?: string;
  children: ReactNode;
};

export type SidebarItemButtonProps = SidebarItemShared &
  Omit<ButtonProps, "children" | "variant" | "size"> & {
    as?: "button";
  };

export type SidebarItemLinkProps = SidebarItemShared &
  Omit<ComponentPropsWithoutRef<"a">, "children"> & {
    as: "a";
    href: string;
  };

export type SidebarItemProps = SidebarItemButtonProps | SidebarItemLinkProps;

function itemClassName(
  active?: boolean,
  variant: SidebarItemVariant = "nav",
  className?: string,
): string {
  return [
    "sidebar-item",
    `sidebar-item--${variant}`,
    active && "sidebar-item--active",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

export const SidebarItem = forwardRef<
  HTMLButtonElement | HTMLAnchorElement,
  SidebarItemProps
>(function SidebarItem(props, ref) {
  if (props.as === "a") {
    const {
      as,
      active,
      variant = "nav",
      icon,
      leading,
      className,
      children,
      ...anchorProps
    } = props;
    const lead =
      leading ??
      (icon ? <span className="sidebar-item__icon">{icon}</span> : null);

    return (
      <a
        ref={ref as Ref<HTMLAnchorElement>}
        className={itemClassName(active, variant, className)}
        aria-current={active ? "page" : undefined}
        {...anchorProps}
      >
        {lead}
        <span className="sidebar-item__label">{children}</span>
      </a>
    );
  }

  const {
    as,
    active,
    variant = "nav",
    icon,
    leading,
    className,
    children,
    type = "button",
    ...buttonProps
  } = props;
  const lead =
    leading ??
    (icon ? <span className="sidebar-item__icon">{icon}</span> : null);

  return (
    <Button
      ref={ref as Ref<HTMLButtonElement>}
      type={type}
      variant="ghost"
      size="sm"
      className={itemClassName(active, variant, className)}
      aria-current={active ? "page" : undefined}
      {...buttonProps}
    >
      {lead}
      <span className="sidebar-item__label">{children}</span>
    </Button>
  );
});

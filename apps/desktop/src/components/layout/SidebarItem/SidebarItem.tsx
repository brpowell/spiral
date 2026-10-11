import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type Ref,
} from "react";
import { Button, type ButtonProps } from "../../common/Button/Button";
import "./SidebarItem.css";

type SidebarItemShared = {
  active?: boolean;
  icon?: ReactNode;
  leading?: ReactNode;
  /** Second line under the label (e.g. a date). */
  subtitle?: ReactNode;
  /** Trailing accessory (e.g. an installed check). */
  trailing?: ReactNode;
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
  className?: string,
  detailed?: boolean,
): string {
  return [
    "sidebar-item",
    active && "sidebar-item--active",
    detailed && "sidebar-item--detailed",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

function SidebarItemBody({
  lead,
  children,
  subtitle,
  trailing,
}: {
  lead: ReactNode;
  children: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <>
      {lead}
      <span className="sidebar-item__text">
        <span className="sidebar-item__label">{children}</span>
        {subtitle != null && subtitle !== "" ? (
          <span className="sidebar-item__subtitle">{subtitle}</span>
        ) : null}
      </span>
      {trailing != null ? (
        <span className="sidebar-item__trailing">{trailing}</span>
      ) : null}
    </>
  );
}

export const SidebarItem = forwardRef<
  HTMLButtonElement | HTMLAnchorElement,
  SidebarItemProps
>(function SidebarItem(props, ref) {
  if (props.as === "a") {
    const {
      as: _as,
      active,
      icon,
      leading,
      subtitle,
      trailing,
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
        className={itemClassName(
          active,
          className,
          subtitle != null && subtitle !== "",
        )}
        aria-current={active ? "page" : undefined}
        {...anchorProps}
      >
        <SidebarItemBody lead={lead} subtitle={subtitle} trailing={trailing}>
          {children}
        </SidebarItemBody>
      </a>
    );
  }

  const {
    as: _as,
    active,
    icon,
    leading,
    subtitle,
    trailing,
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
      className={itemClassName(
        active,
        className,
        subtitle != null && subtitle !== "",
      )}
      aria-current={active ? "page" : undefined}
      {...buttonProps}
    >
      <SidebarItemBody lead={lead} subtitle={subtitle} trailing={trailing}>
        {children}
      </SidebarItemBody>
    </Button>
  );
});

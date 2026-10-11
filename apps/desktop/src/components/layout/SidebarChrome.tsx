import type {
  ComponentPropsWithoutRef,
  ElementType,
  ReactNode,
} from "react";
import "./SidebarChrome.css";

type SidebarFrameProps = {
  as?: "nav" | "aside" | "div";
  children: ReactNode;
  className?: string;
  /**
   * Nest inside a custom rail (e.g. Studio sidebar column). Skips width / border /
   * background so the parent owns the column chrome.
   */
  embedded?: boolean;
} & Omit<ComponentPropsWithoutRef<"nav">, "children" | "className">;

export function SidebarFrame({
  as,
  children,
  className,
  embedded = false,
  ...rest
}: SidebarFrameProps) {
  const Comp = (as ?? "nav") as ElementType;
  return (
    <Comp
      className={[
        "sidebar",
        embedded ? "sidebar--embedded" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </Comp>
  );
}

type SidebarListProps = {
  children: ReactNode;
  className?: string;
} & Omit<ComponentPropsWithoutRef<"ul">, "children" | "className">;

export function SidebarList({ children, className, ...rest }: SidebarListProps) {
  return (
    <ul
      className={["sidebar__list", className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </ul>
  );
}

type SidebarSectionProps = {
  children: ReactNode;
  label?: string;
  /** Fill remaining height (library Playlists). */
  grow?: boolean;
  className?: string;
  "aria-label"?: string;
};

export function SidebarSection({
  children,
  label,
  grow = false,
  className,
  "aria-label": ariaLabel,
}: SidebarSectionProps) {
  return (
    <section
      className={[
        "sidebar__section",
        grow ? "sidebar__section--grow" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={ariaLabel ?? label}
    >
      {label ? <h2 className="sidebar__section-label">{label}</h2> : null}
      {children}
    </section>
  );
}

type SidebarFooterProps = {
  children: ReactNode;
  className?: string;
};

export function SidebarFooter({ children, className }: SidebarFooterProps) {
  return (
    <div
      className={["sidebar__footer", className].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
}

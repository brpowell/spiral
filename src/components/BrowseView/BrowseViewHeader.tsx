import type { ReactNode } from "react";
import "./BrowseView.css";

interface BrowseViewHeaderProps {
  title: string;
  count: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function BrowseViewHeader({
  title,
  count,
  actions,
  className = "",
}: BrowseViewHeaderProps) {
  return (
    <header
      className={["browse-view__header", className].filter(Boolean).join(" ")}
    >
      <div className="browse-view__heading">
        <h1 className="browse-view__title">{title}</h1>
        <span className="browse-view__count">{count}</span>
      </div>
      {actions}
    </header>
  );
}

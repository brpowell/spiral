import type { ReactNode } from "react";
import "./BrowseGridBody.css";

interface BrowseGridBodyProps {
  children: ReactNode;
}

export function BrowseGridBody({ children }: BrowseGridBodyProps) {
  return (
    <div className="browse-grid-view__shell">
      <div className="browse-grid-view__body">{children}</div>
    </div>
  );
}

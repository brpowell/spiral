import type { ReactNode } from "react";
import "./BrowseView.css";

interface BrowseViewProps {
  className?: string;
  children: ReactNode;
}

export function BrowseView({ className = "", children }: BrowseViewProps) {
  return (
    <div
      className={["browse-view", className].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
}

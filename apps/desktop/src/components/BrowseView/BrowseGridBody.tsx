import type { ReactNode, Ref } from "react";
import "./BrowseGridBody.css";

interface BrowseGridBodyProps {
  children: ReactNode;
  bodyRef?: Ref<HTMLDivElement | null>;
}

export function BrowseGridBody({ children, bodyRef }: BrowseGridBodyProps) {
  return (
    <div className="browse-grid-view__shell">
      <div ref={bodyRef} className="browse-grid-view__body">
        {children}
      </div>
    </div>
  );
}

import type { ReactNode, Ref, UIEventHandler } from "react";
import "./BrowseGridBody.css";

interface BrowseGridBodyProps {
  children: ReactNode;
  bodyRef?: Ref<HTMLDivElement | null>;
  onScroll?: UIEventHandler<HTMLDivElement>;
}

export function BrowseGridBody({
  children,
  bodyRef,
  onScroll,
}: BrowseGridBodyProps) {
  return (
    <div className="browse-grid-view__shell">
      <div ref={bodyRef} className="browse-grid-view__body" onScroll={onScroll}>
        {children}
      </div>
    </div>
  );
}

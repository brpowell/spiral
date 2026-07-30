import type { ReactNode } from "react";
import type { AppMenuHandlers } from "../../lib/appMenu";
import { usesCustomWindowChrome } from "../../lib/windowChrome";
import { WindowTitleBar } from "./WindowTitleBar";
import "./CustomWindowFrame.css";

export interface CustomWindowFrameProps {
  title: string;
  children: ReactNode;
  /** Main window only — secondary windows use title + controls. */
  handlers?: AppMenuHandlers;
  showMaximize?: boolean;
  className?: string;
}

/** In-app title bar on Windows/Linux; passthrough on macOS. */
export function CustomWindowFrame({
  title,
  children,
  handlers,
  showMaximize = true,
  className,
}: CustomWindowFrameProps) {
  if (!usesCustomWindowChrome()) {
    return className ? <div className={className}>{children}</div> : <>{children}</>;
  }

  return (
    <div
      className={["custom-window-frame", className].filter(Boolean).join(" ")}
    >
      <WindowTitleBar
        title={title}
        handlers={handlers}
        showMaximize={showMaximize}
      />
      <div className="custom-window-frame__body">{children}</div>
    </div>
  );
}

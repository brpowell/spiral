import type { ReactNode } from "react";
import type { AppMenuHandlers } from "../../lib/appMenu";
import {
  usesCustomWindowChrome,
  usesMacOverlayChrome,
} from "../../lib/windowChrome";
import { MacOverlayTitleBar } from "./MacOverlayTitleBar";
import { WindowTitleBar } from "./WindowTitleBar";
import "./CustomWindowFrame.css";

export interface CustomWindowFrameProps {
  title: string;
  children: ReactNode;
  /** Main window only — secondary windows use title + controls. */
  handlers?: AppMenuHandlers;
  /** macOS overlay bar. Library window is a drag strip with no label. */
  showTitle?: boolean;
  showMaximize?: boolean;
  className?: string;
}

/** Windows/Linux in-app controls, or a macOS overlay bar under traffic lights. */
export function CustomWindowFrame({
  title,
  children,
  handlers,
  showTitle = true,
  showMaximize = true,
  className,
}: CustomWindowFrameProps) {
  if (!usesCustomWindowChrome() && !usesMacOverlayChrome()) {
    return className ? (
      <div className={className}>{children}</div>
    ) : (
      <>{children}</>
    );
  }

  const macOverlay = usesMacOverlayChrome();

  return (
    <div
      className={[
        "custom-window-frame",
        macOverlay ? "custom-window-frame--mac" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {macOverlay ? (
        <MacOverlayTitleBar
          title={showTitle ? title : undefined}
          showMaximize={showMaximize}
        />
      ) : (
        <WindowTitleBar
          title={title}
          handlers={handlers}
          showMaximize={showMaximize}
        />
      )}
      <div className="custom-window-frame__body">{children}</div>
    </div>
  );
}

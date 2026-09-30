import { getCurrentWindow } from "@tauri-apps/api/window";
import "./MacOverlayTitleBar.css";

export interface MacOverlayTitleBarProps {
  /** Omitted on the library window — the bar is only a drag strip. */
  title?: string;
  /** Double-click zooms the window. Off for fixed-size windows (Equalizer). */
  showMaximize?: boolean;
}

/**
 * Themed strip drawn under macOS traffic lights.
 * The native buttons stay; this row is a drag region, plus a title on secondary windows.
 */
export function MacOverlayTitleBar({
  title,
  showMaximize = true,
}: MacOverlayTitleBarProps) {
  const onDoubleClick = () => {
    if (!showMaximize) return;
    void getCurrentWindow().toggleMaximize();
  };

  return (
    <div
      className="mac-overlay-titlebar"
      data-tauri-drag-region
      onDoubleClick={onDoubleClick}
    >
      {title ? (
        <span className="mac-overlay-titlebar__title">{title}</span>
      ) : null}
    </div>
  );
}

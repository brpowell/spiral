import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../ContextMenu/ContextMenu";
import {
  IconClose,
  IconWindowMaximize,
  IconWindowMinimize,
  IconWindowRestore,
} from "../icons";
import {
  linkedPacksAvailable,
  type AppMenuBarId,
  type AppMenuHandlers,
} from "../../lib/appMenu";
import { LINKED_PACKS_CHANGED_EVENT } from "../../lib/appearanceWindow";
import { t } from "../../lib/i18n";
import { useContextMenu } from "../../hooks/useContextMenu";
import "./WindowTitleBar.css";

const MENU_ITEMS: { id: AppMenuBarId; label: string }[] = [
  { id: "file", label: "File" },
  { id: "edit", label: "Edit" },
  { id: "view", label: "View" },
];

function runEditCommand(
  command: "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll",
): void {
  document.execCommand(command === "selectAll" ? "selectAll" : command);
}

export interface WindowTitleBarProps {
  /** Shown in the title bar; defaults to "Spiral". */
  title?: string;
  /** When set, File / Edit / View menus are shown (main library window). */
  handlers?: AppMenuHandlers;
  /** Hide maximize when the window is fixed-size (e.g. Equalizer). */
  showMaximize?: boolean;
}

export function WindowTitleBar({
  title = "Spiral",
  handlers,
  showMaximize = true,
}: WindowTitleBarProps) {
  const showMenus = handlers != null;
  const [maximized, setMaximized] = useState(false);
  const [activeMenu, setActiveMenu] = useState<AppMenuBarId | null>(null);
  const [reloadLinkedEnabled, setReloadLinkedEnabled] = useState(false);
  const menusRef = useRef<HTMLElement | null>(null);

  const {
    open,
    anchor,
    position,
    menuRef,
    openedWithKeyboard,
    closeMenu,
    openFromTrigger,
  } = useContextMenu({
    dismissExcludeRefs: [menusRef],
    triggerPlacement: "below-start",
    layoutDeps: [activeMenu, reloadLinkedEnabled],
  });

  useEffect(() => {
    const window = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    void window.isMaximized().then(setMaximized);
    void window
      .onResized(() => {
        void window.isMaximized().then(setMaximized);
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!showMenus) return;
    void linkedPacksAvailable().then(setReloadLinkedEnabled);
    const unlisten = listen(LINKED_PACKS_CHANGED_EVENT, () => {
      void linkedPacksAvailable().then(setReloadLinkedEnabled);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [showMenus]);

  useEffect(() => {
    if (!open) setActiveMenu(null);
  }, [open]);

  const openMenu = (id: AppMenuBarId, el: HTMLElement, keyboard?: boolean) => {
    setActiveMenu(id);
    openFromTrigger(el, { keyboard });
  };

  const onMenuClick = (id: AppMenuBarId, e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const el = e.currentTarget;
    if (activeMenu === id) {
      closeMenu();
      setActiveMenu(null);
      return;
    }
    openMenu(id, el, e.detail === 0);
  };

  const onMenuEnter = (id: AppMenuBarId, e: MouseEvent<HTMLButtonElement>) => {
    if (activeMenu === null || activeMenu === id) return;
    openMenu(id, e.currentTarget);
  };

  const onDragDoubleClick = () => {
    if (!showMaximize) return;
    void getCurrentWindow().toggleMaximize();
  };

  const run = (action: () => void) => () => {
    closeMenu();
    setActiveMenu(null);
    action();
  };

  let menuContent: ReactNode = null;
  if (handlers && activeMenu === "file") {
    menuContent = (
      <>
        <ContextMenuItem
          label="Add Files to Library…"
          onClick={run(handlers.addToLibrary)}
        />
        <ContextMenuItem
          label="New Playlist…"
          onClick={run(handlers.newPlaylist)}
        />
        <ContextMenuSeparator />
        <ContextMenuItem
          label="Refresh Library Metadata"
          onClick={run(handlers.refreshLibraryMetadata)}
        />
        <ContextMenuItem
          label="Fetch Missing Lyrics"
          onClick={run(handlers.fetchMissingLyrics)}
        />
        <ContextMenuSeparator />
        <ContextMenuItem
          label="Preferences"
          onClick={run(handlers.openPreferences)}
        />
        <ContextMenuItem
          label="Spiral Card…"
          onClick={run(handlers.openSpiralCard)}
        />
        <ContextMenuItem
          label={t("common:updates.menu.check")}
          onClick={run(handlers.checkForUpdates)}
        />
        <ContextMenuSeparator />
        <ContextMenuItem label="Exit" onClick={run(handlers.quit)} />
      </>
    );
  } else if (handlers && activeMenu === "edit") {
    menuContent = (
      <>
        <ContextMenuItem
          label="Undo"
          onClick={run(() => runEditCommand("undo"))}
        />
        <ContextMenuItem
          label="Redo"
          onClick={run(() => runEditCommand("redo"))}
        />
        <ContextMenuSeparator />
        <ContextMenuItem
          label="Cut"
          onClick={run(() => runEditCommand("cut"))}
        />
        <ContextMenuItem
          label="Copy"
          onClick={run(() => runEditCommand("copy"))}
        />
        <ContextMenuItem
          label="Paste"
          onClick={run(() => runEditCommand("paste"))}
        />
        <ContextMenuItem
          label="Select All"
          onClick={run(() => runEditCommand("selectAll"))}
        />
      </>
    );
  } else if (handlers && activeMenu === "view") {
    menuContent = (
      <>
        <ContextMenuItem
          label="Skin Mode"
          onClick={run(handlers.openSkinMode)}
        />
        <ContextMenuItem
          label="Studio"
          onClick={run(handlers.openAppearance)}
        />
        <ContextMenuItem
          label="Reload Linked Packs"
          disabled={!reloadLinkedEnabled}
          onClick={run(handlers.reloadLinkedPacks)}
        />
        <ContextMenuSeparator />
        <ContextMenuItem
          label="Equalizer"
          onClick={run(handlers.openEqualizer)}
        />
        <ContextMenuItem
          label="Activity Logs"
          onClick={run(handlers.openActivityLogs)}
        />
      </>
    );
  }

  return (
    <div className="window-titlebar" role="banner">
      <div
        className="window-titlebar__drag"
        data-tauri-drag-region="deep"
        onDoubleClick={onDragDoubleClick}
      >
        <span className="window-titlebar__title">{title}</span>

        {showMenus ? (
          <nav
            ref={menusRef}
            className="window-titlebar__menus"
            aria-label="Application"
            data-tauri-drag-region="false"
          >
            {MENU_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={[
                  "window-titlebar__menu-btn",
                  activeMenu === item.id
                    ? "window-titlebar__menu-btn--active"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-expanded={activeMenu === item.id}
                aria-haspopup="menu"
                onClick={(e) => onMenuClick(item.id, e)}
                onMouseEnter={(e) => onMenuEnter(item.id, e)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        ) : null}
      </div>

      <div className="window-titlebar__controls" data-tauri-drag-region="false">
        <button
          type="button"
          className="window-titlebar__control"
          aria-label="Minimize"
          title="Minimize"
          onClick={() => void getCurrentWindow().minimize()}
        >
          <IconWindowMinimize />
        </button>
        {showMaximize ? (
          <button
            type="button"
            className="window-titlebar__control"
            aria-label={maximized ? "Restore" : "Maximize"}
            title={maximized ? "Restore" : "Maximize"}
            onClick={() => void getCurrentWindow().toggleMaximize()}
          >
            {maximized ? <IconWindowRestore /> : <IconWindowMaximize />}
          </button>
        ) : null}
        <button
          type="button"
          className="window-titlebar__control window-titlebar__control--close"
          aria-label="Close"
          title="Close"
          onClick={() => void getCurrentWindow().close()}
        >
          <IconClose />
        </button>
      </div>

      {showMenus ? (
        <ContextMenu
          open={open && activeMenu != null}
          anchor={anchor}
          position={position}
          menuRef={menuRef}
          focusFirstItem={openedWithKeyboard}
        >
          {menuContent}
        </ContextMenu>
      ) : null}
    </div>
  );
}

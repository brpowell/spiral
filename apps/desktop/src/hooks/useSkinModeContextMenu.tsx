import { useCallback } from "react";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../components/ContextMenu/ContextMenu";
import { IconPalette, IconTracks } from "../components/icons";
import { openAppearanceWindow } from "../lib/appearanceWindow";
import { t } from "../lib/i18n";
import { useSkinModeAlwaysOnTop } from "../lib/skinModeAlwaysOnTop";
import {
  restoreMainWindow,
  setSkinModeAlwaysOnTop,
} from "../lib/skinModeWindow";
import { isSkinModeWindow } from "../lib/windowRole";
import { useContextMenu } from "./useContextMenu";

export function useSkinModeContextMenu() {
  const pinned = useSkinModeAlwaysOnTop();
  const { openAt, closeMenu, open, anchor, position, menuRef } = useContextMenu(
    {
      layoutDeps: [pinned],
    },
  );

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isSkinModeWindow()) return;
      openAt(e.clientX, e.clientY);
    },
    [openAt],
  );

  const handleTogglePin = useCallback(() => {
    void setSkinModeAlwaysOnTop(!pinned);
  }, [pinned]);

  const handleOpenStudio = useCallback(() => {
    closeMenu();
    void openAppearanceWindow("skins");
  }, [closeMenu]);

  const handleReturnToLibrary = useCallback(() => {
    closeMenu();
    void restoreMainWindow();
  }, [closeMenu]);

  const contextMenu = open ? (
    <ContextMenu
      open={open}
      anchor={anchor}
      position={position}
      menuRef={menuRef}
    >
      <ContextMenuCheckboxItem
        checked={pinned}
        label={t("playback:skinMode.contextMenu.pinWindow")}
        onClick={handleTogglePin}
      />
      <ContextMenuSeparator />
      <ContextMenuItem
        icon={<IconPalette />}
        label={t("playback:skinMode.contextMenu.studio")}
        onClick={handleOpenStudio}
      />
      <ContextMenuItem
        icon={<IconTracks />}
        label={t("playback:skinMode.contextMenu.returnToLibrary")}
        onClick={handleReturnToLibrary}
      />
    </ContextMenu>
  ) : null;

  return { onContextMenu, contextMenu };
}

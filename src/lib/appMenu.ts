import { listen } from "@tauri-apps/api/event";
import {
  Menu,
  MenuItem,
  PredefinedMenuItem,
  Submenu,
} from "@tauri-apps/api/menu";
import { LINKED_PACKS_CHANGED_EVENT } from "./appearanceWindow";
import { t } from "./i18n";
import { listPacks } from "./tauri";

export interface AppMenuHandlers {
  addToLibrary: () => void;
  refreshLibraryMetadata: () => void;
  fetchMissingLyrics: () => void;
  newPlaylist: () => void;
  openPreferences: () => void;
  openSpiralCard: () => void;
  checkForUpdates: () => void;
  openSkinMode: () => void;
  openAppearance: () => void;
  openEqualizer: () => void;
  openActivityLogs: () => void;
  reloadLinkedPacks: () => void;
  /** Custom chrome File → Exit (macOS uses the system Quit item). */
  quit: () => void;
  /** DEV-only: toggle the Toast Lab window. */
  toggleToastLab?: () => void;
}

export type AppMenuBarId = "file" | "edit" | "view" | "developer";

const RELOAD_LINKED_PACKS_ID = "reload-linked-packs";

let reloadLinkedPacksItem: MenuItem | null = null;
let linkedPacksListenerBound = false;

async function hasLinkedPacks(): Promise<boolean> {
  try {
    const packs = await listPacks();
    return packs.some((pack) => pack.zone === "linked");
  } catch (err) {
    console.error("Failed to check linked packs:", err);
    return false;
  }
}

/** Whether any packs are linked (View → Reload Linked Packs enablement). */
export async function linkedPacksAvailable(): Promise<boolean> {
  return hasLinkedPacks();
}

/** Enable/disable Reload Linked Packs based on whether any packs are linked. */
async function syncReloadLinkedPacksMenuEnabled(): Promise<void> {
  if (!reloadLinkedPacksItem) return;
  try {
    await reloadLinkedPacksItem.setEnabled(await hasLinkedPacks());
  } catch (err) {
    console.error("Failed to sync Reload Linked Packs menu state:", err);
  }
}

/**
 * Installs the native macOS app menu. Windows/Linux skip this and use
 * {@link WindowTitleBar} instead.
 */
export async function setupAppMenu(handlers: AppMenuHandlers): Promise<void> {
  const preferences = await MenuItem.new({
    id: "preferences",
    text: "Preferences",
    accelerator: "CmdOrCtrl+,",
    action: handlers.openPreferences,
  });
  const spiralCard = await MenuItem.new({
    id: "spiral-card",
    text: "Spiral Card…",
    action: handlers.openSpiralCard,
  });
  const checkForUpdates = await MenuItem.new({
    id: "check-for-updates",
    text: t("common:updates.menu.check"),
    action: handlers.checkForUpdates,
  });
  const quit = await PredefinedMenuItem.new({ item: "Quit" });
  const spiralSeparator = await PredefinedMenuItem.new({ item: "Separator" });

  const spiralSubmenu = await Submenu.new({
    text: "Spiral",
    items: [preferences, spiralCard, checkForUpdates, spiralSeparator, quit],
  });

  const addToLibrary = await MenuItem.new({
    id: "add-to-library",
    text: "Add Files to Library…",
    action: handlers.addToLibrary,
  });

  const newPlaylist = await MenuItem.new({
    id: "new-playlist",
    text: "New Playlist…",
    action: handlers.newPlaylist,
  });

  const fileSeparator = await PredefinedMenuItem.new({ item: "Separator" });

  const refreshLibraryMetadata = await MenuItem.new({
    id: "refresh-library-metadata",
    text: "Refresh Library Metadata",
    action: handlers.refreshLibraryMetadata,
  });

  const fetchMissingLyrics = await MenuItem.new({
    id: "fetch-missing-lyrics",
    text: "Fetch Missing Lyrics",
    action: handlers.fetchMissingLyrics,
  });

  const fileSubmenu = await Submenu.new({
    text: "File",
    items: [
      addToLibrary,
      newPlaylist,
      fileSeparator,
      refreshLibraryMetadata,
      fetchMissingLyrics,
    ],
  });

  const undo = await PredefinedMenuItem.new({ item: "Undo" });
  const redo = await PredefinedMenuItem.new({ item: "Redo" });
  const editSeparator = await PredefinedMenuItem.new({ item: "Separator" });
  const cut = await PredefinedMenuItem.new({ item: "Cut" });
  const copy = await PredefinedMenuItem.new({ item: "Copy" });
  const paste = await PredefinedMenuItem.new({ item: "Paste" });
  const selectAll = await PredefinedMenuItem.new({ item: "SelectAll" });

  const editSubmenu = await Submenu.new({
    text: "Edit",
    items: [undo, redo, editSeparator, cut, copy, paste, selectAll],
  });

  const skinMode = await MenuItem.new({
    id: "skin-mode",
    text: "Skin Mode",
    action: handlers.openSkinMode,
  });

  const appearance = await MenuItem.new({
    id: "appearance",
    text: "Studio",
    action: handlers.openAppearance,
  });

  const linked = await hasLinkedPacks();
  const reloadLinkedPacks = await MenuItem.new({
    id: RELOAD_LINKED_PACKS_ID,
    text: "Reload Linked Packs",
    accelerator: "CmdOrCtrl+Alt+R",
    enabled: linked,
    action: handlers.reloadLinkedPacks,
  });
  reloadLinkedPacksItem = reloadLinkedPacks;

  const viewSeparator = await PredefinedMenuItem.new({ item: "Separator" });

  const equalizer = await MenuItem.new({
    id: "equalizer",
    text: "Equalizer",
    action: handlers.openEqualizer,
  });

  const activityLogs = await MenuItem.new({
    id: "activity-logs",
    text: "Activity Logs",
    accelerator: "CmdOrCtrl+Shift+L",
    action: handlers.openActivityLogs,
  });

  const viewSubmenu = await Submenu.new({
    text: "View",
    items: [
      skinMode,
      appearance,
      reloadLinkedPacks,
      viewSeparator,
      equalizer,
      activityLogs,
    ],
  });

  const menuItems = [spiralSubmenu, fileSubmenu, editSubmenu, viewSubmenu];

  if (import.meta.env.DEV && handlers.toggleToastLab) {
    const toastLab = await MenuItem.new({
      id: "toast-lab",
      text: "Toast Lab",
      accelerator: "CmdOrCtrl+Shift+T",
      action: handlers.toggleToastLab,
    });
    const developerSubmenu = await Submenu.new({
      text: "Developer",
      items: [toastLab],
    });
    menuItems.push(developerSubmenu);
  }

  const menu = await Menu.new({
    items: menuItems,
  });
  await menu.setAsAppMenu();

  if (!linkedPacksListenerBound) {
    linkedPacksListenerBound = true;
    void listen(LINKED_PACKS_CHANGED_EVENT, () => {
      void syncReloadLinkedPacksMenuEnabled();
    });
  }
}

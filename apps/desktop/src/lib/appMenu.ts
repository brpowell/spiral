import { listen } from "@tauri-apps/api/event";
import {
  Menu,
  MenuItem,
  PredefinedMenuItem,
  Submenu,
} from "@tauri-apps/api/menu";
import { LINKED_PACKS_CHANGED_EVENT } from "./appearanceWindow";
import { stubLocaleMenuLabel } from "./appLocale";
import { t } from "./i18n";
import { listItems } from "./tauri";

export interface AppMenuHandlers {
  addToLibrary: () => void;
  refreshLibraryMetadata: () => void;
  fetchMissingLyrics: () => void;
  newPlaylist: () => void;
  openPreferences: () => void;
  checkForUpdates: () => void;
  openAbout: () => void;
  openSkinMode: () => void;
  openAppearance: () => void;
  openEqualizer: () => void;
  openActivityLogs: () => void;
  reloadLinkedPacks: () => void;
  /** Custom chrome Spiral → Exit (macOS uses the system Quit item). */
  quit: () => void;
  /** DEV-only: toggle the Toast Lab window. */
  toggleToastLab?: () => void;
  /** DEV-only: toggle the transport signature Sound Lab. */
  toggleSoundLab?: () => void;
  /** DEV-only: seed a fake pending update for UX testing. */
  simulateMockUpdate?: () => void;
  /** DEV-only: forget that the welcome screen was seen and reload, simulating a first launch. */
  resetOnboarding?: () => void;
  /** DEV-only: persist the stub locale and reload to prove catalog switching. */
  toggleStubLocale?: () => void;
}

export type AppMenuBarId = "app" | "file" | "edit" | "view" | "developer";

const RELOAD_LINKED_PACKS_ID = "reload-linked-packs";

let reloadLinkedPacksItem: MenuItem | null = null;
let linkedPacksListenerBound = false;

async function hasLinkedPacks(): Promise<boolean> {
  try {
    const items = await listItems();
    return items.some((item) => item.zone === "linked");
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
  const about = await MenuItem.new({
    id: "about",
    text: t("menus:app.about"),
    action: handlers.openAbout,
  });
  const preferences = await MenuItem.new({
    id: "preferences",
    text: t("menus:app.preferences"),
    accelerator: "CmdOrCtrl+,",
    action: handlers.openPreferences,
  });
  const checkForUpdates = await MenuItem.new({
    id: "check-for-updates",
    text: t("common:updates.menu.check"),
    action: handlers.checkForUpdates,
  });
  const quit = await PredefinedMenuItem.new({ item: "Quit" });
  const aboutSeparator = await PredefinedMenuItem.new({ item: "Separator" });
  const spiralSeparator = await PredefinedMenuItem.new({ item: "Separator" });

  const spiralSubmenu = await Submenu.new({
    text: t("menus:app.name"),
    items: [
      about,
      checkForUpdates,
      aboutSeparator,
      preferences,
      spiralSeparator,
      quit,
    ],
  });

  const addToLibrary = await MenuItem.new({
    id: "add-to-library",
    text: t("menus:file.addToLibrary"),
    action: handlers.addToLibrary,
  });

  const newPlaylist = await MenuItem.new({
    id: "new-playlist",
    text: t("menus:file.newPlaylist"),
    action: handlers.newPlaylist,
  });

  const fileSeparator = await PredefinedMenuItem.new({ item: "Separator" });

  const refreshLibraryMetadata = await MenuItem.new({
    id: "refresh-library-metadata",
    text: t("menus:file.refreshLibraryMetadata"),
    action: handlers.refreshLibraryMetadata,
  });

  const fetchMissingLyrics = await MenuItem.new({
    id: "fetch-missing-lyrics",
    text: t("menus:file.fetchMissingLyrics"),
    action: handlers.fetchMissingLyrics,
  });

  const fileSubmenu = await Submenu.new({
    text: t("menus:bar.file"),
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
    text: t("menus:bar.edit"),
    items: [undo, redo, editSeparator, cut, copy, paste, selectAll],
  });

  const skinMode = await MenuItem.new({
    id: "skin-mode",
    text: t("menus:view.skinMode"),
    action: handlers.openSkinMode,
  });

  const appearance = await MenuItem.new({
    id: "appearance",
    text: t("menus:view.studio"),
    action: handlers.openAppearance,
  });

  const linked = await hasLinkedPacks();
  const reloadLinkedPacks = await MenuItem.new({
    id: RELOAD_LINKED_PACKS_ID,
    text: t("menus:view.reloadLinkedPacks"),
    accelerator: "CmdOrCtrl+Alt+R",
    enabled: linked,
    action: handlers.reloadLinkedPacks,
  });
  reloadLinkedPacksItem = reloadLinkedPacks;

  const viewSeparator = await PredefinedMenuItem.new({ item: "Separator" });

  const equalizer = await MenuItem.new({
    id: "equalizer",
    text: t("menus:view.equalizer"),
    action: handlers.openEqualizer,
  });

  const activityLogs = await MenuItem.new({
    id: "activity-logs",
    text: t("menus:view.activityLogs"),
    accelerator: "CmdOrCtrl+Shift+L",
    action: handlers.openActivityLogs,
  });

  const viewSubmenu = await Submenu.new({
    text: t("menus:bar.view"),
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

  if (
    import.meta.env.DEV &&
    (handlers.toggleToastLab ||
      handlers.toggleSoundLab ||
      handlers.simulateMockUpdate ||
      handlers.resetOnboarding ||
      handlers.toggleStubLocale)
  ) {
    const developerItems = [];
    if (handlers.toggleToastLab) {
      developerItems.push(
        await MenuItem.new({
          id: "toast-lab",
          text: "Toast Lab",
          accelerator: "CmdOrCtrl+Shift+T",
          action: handlers.toggleToastLab,
        }),
      );
    }
    if (handlers.toggleSoundLab) {
      developerItems.push(
        await MenuItem.new({
          id: "sound-lab",
          text: "Sound Lab",
          accelerator: "CmdOrCtrl+Alt+S",
          action: handlers.toggleSoundLab,
        }),
      );
    }
    if (handlers.simulateMockUpdate) {
      developerItems.push(
        await MenuItem.new({
          id: "simulate-update",
          text: "Simulate Update…",
          action: handlers.simulateMockUpdate,
        }),
      );
    }
    if (handlers.resetOnboarding) {
      developerItems.push(
        await MenuItem.new({
          id: "reset-onboarding",
          text: "Reset welcome screen",
          action: handlers.resetOnboarding,
        }),
      );
    }
    if (handlers.toggleStubLocale) {
      developerItems.push(
        await MenuItem.new({
          id: "toggle-stub-locale",
          text: stubLocaleMenuLabel(),
          action: handlers.toggleStubLocale,
        }),
      );
    }
    const developerSubmenu = await Submenu.new({
      text: "Developer",
      items: developerItems,
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

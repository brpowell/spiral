import { listen } from "@tauri-apps/api/event";
import {
  Menu,
  MenuItem,
  PredefinedMenuItem,
  Submenu,
} from "@tauri-apps/api/menu";
import { LINKED_PACKS_CHANGED_EVENT } from "./appearanceWindow";
import { listPacks } from "./tauri";

export interface AppMenuHandlers {
  addToLibrary: () => void;
  refreshLibraryMetadata: () => void;
  fetchMissingLyrics: () => void;
  newPlaylist: () => void;
  openPreferences: () => void;
  openSkinMode: () => void;
  openAppearance: () => void;
  openEqualizer: () => void;
  openActivityLogs: () => void;
  reloadLinkedPacks: () => void;
}

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

/** Enable/disable Reload Linked Packs based on whether any packs are linked. */
async function syncReloadLinkedPacksMenuEnabled(): Promise<void> {
  if (!reloadLinkedPacksItem) return;
  try {
    await reloadLinkedPacksItem.setEnabled(await hasLinkedPacks());
  } catch (err) {
    console.error("Failed to sync Reload Linked Packs menu state:", err);
  }
}

export async function setupAppMenu(handlers: AppMenuHandlers): Promise<void> {
  const preferences = await MenuItem.new({
    id: "preferences",
    text: "Preferences",
    accelerator: "Cmd+,",
    action: handlers.openPreferences,
  });
  const quit = await PredefinedMenuItem.new({ item: "Quit" });

  const appSubmenu = await Submenu.new({
    text: "Spiral",
    items: [preferences, quit],
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
    accelerator: "Cmd+Alt+R",
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
    accelerator: "Cmd+Shift+L",
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

  const menu = await Menu.new({
    items: [appSubmenu, fileSubmenu, editSubmenu, viewSubmenu],
  });

  await menu.setAsAppMenu();

  if (!linkedPacksListenerBound) {
    linkedPacksListenerBound = true;
    void listen(LINKED_PACKS_CHANGED_EVENT, () => {
      void syncReloadLinkedPacksMenuEnabled();
    });
  }
}

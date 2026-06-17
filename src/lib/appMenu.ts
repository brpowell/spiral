import {
  Menu,
  MenuItem,
  PredefinedMenuItem,
  Submenu,
} from "@tauri-apps/api/menu";

export interface AppMenuHandlers {
  addToLibrary: () => void;
  newPlaylist: () => void;
  openPreferences: () => void;
  openSkinMode: () => void;
  openAppearance: () => void;
  openActivityLogs: () => void;
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

  const fileSubmenu = await Submenu.new({
    text: "File",
    items: [addToLibrary, newPlaylist],
  });

  const skinMode = await MenuItem.new({
    id: "skin-mode",
    text: "Skin Mode",
    action: handlers.openSkinMode,
  });

  const appearance = await MenuItem.new({
    id: "appearance",
    text: "Appearance…",
    action: handlers.openAppearance,
  });

  const activityLogs = await MenuItem.new({
    id: "activity-logs",
    text: "Activity Logs",
    accelerator: "Cmd+Shift+L",
    action: handlers.openActivityLogs,
  });

  const viewSubmenu = await Submenu.new({
    text: "View",
    items: [skinMode, appearance, activityLogs],
  });

  const menu = await Menu.new({
    items: [appSubmenu, fileSubmenu, viewSubmenu],
  });

  await menu.setAsAppMenu();
}

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

  const menu = await Menu.new({
    items: [appSubmenu, fileSubmenu],
  });

  await menu.setAsAppMenu();
}

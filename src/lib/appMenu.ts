import {
  Menu,
  MenuItem,
  PredefinedMenuItem,
  Submenu,
} from "@tauri-apps/api/menu";

export interface AppMenuHandlers {
  addToLibrary: () => void;
}

export async function setupAppMenu(handlers: AppMenuHandlers): Promise<void> {
  const hide = await PredefinedMenuItem.new({ item: "Hide" });
  const quit = await PredefinedMenuItem.new({ item: "Quit" });

  const appSubmenu = await Submenu.new({
    text: "Spiral",
    items: [hide, quit],
  });

  const addToLibrary = await MenuItem.new({
    id: "add-to-library",
    text: "Add Files to Library…",
    action: handlers.addToLibrary,
  });

  const fileSubmenu = await Submenu.new({
    text: "File",
    items: [addToLibrary],
  });

  const menu = await Menu.new({
    items: [appSubmenu, fileSubmenu],
  });

  await menu.setAsAppMenu();
}

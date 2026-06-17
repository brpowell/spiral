import {
  CheckMenuItem,
  Menu,
  MenuItem,
  PredefinedMenuItem,
} from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openAppearanceWindow } from "./appearanceWindow";
import {
  DEFAULT_SKIN_MODE_ALWAYS_ON_TOP,
  readSkinModeAlwaysOnTop,
  restoreMainWindow,
  setSkinModeAlwaysOnTop,
} from "./skinModeWindow";
import { isTauri } from "./windowRole";

const SKIN_MODE_WINDOW_LABEL = "skin-mode";

let menuPromise: Promise<Menu> | null = null;
let pinItem: CheckMenuItem | null = null;

async function createMenu(): Promise<Menu> {
  pinItem = await CheckMenuItem.new({
    id: "skin-mode-pin",
    text: "Pin window",
    checked: DEFAULT_SKIN_MODE_ALWAYS_ON_TOP,
    action: async () => {
      const next =
        (await pinItem?.isChecked()) ?? DEFAULT_SKIN_MODE_ALWAYS_ON_TOP;
      await setSkinModeAlwaysOnTop(next);
    },
  });

  const openAppearance = await MenuItem.new({
    id: "skin-mode-open-appearance",
    text: "Appearance…",
    action: () => {
      void openAppearanceWindow("skins");
    },
  });

  const returnLibrary = await MenuItem.new({
    id: "skin-mode-return-library",
    text: "Return to library mode",
    action: () => {
      void restoreMainWindow();
    },
  });

  const separator = await PredefinedMenuItem.new({ item: "Separator" });

  return Menu.new({
    id: "skin-mode-context",
    items: [pinItem, separator, openAppearance, returnLibrary],
  });
}

async function getMenu(): Promise<Menu> {
  menuPromise ??= createMenu();
  return menuPromise;
}

export async function showSkinModeNativeContextMenu(): Promise<void> {
  if (!isTauri()) return;

  const window = getCurrentWindow();
  if (window.label !== SKIN_MODE_WINDOW_LABEL) return;

  const [menu, pinned] = await Promise.all([
    getMenu(),
    readSkinModeAlwaysOnTop(),
  ]);

  await pinItem?.setChecked(pinned);
  await menu.popup(undefined, window);
}

export function onSkinModeContextMenu(e: React.MouseEvent): void {
  e.preventDefault();
  e.stopPropagation();
  void showSkinModeNativeContextMenu();
}

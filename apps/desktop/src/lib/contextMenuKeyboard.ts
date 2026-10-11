const CONTEXT_MENU_ITEM_SELECTOR =
  'button[role="menuitem"]:not([disabled]), button[role="menuitemcheckbox"]:not([disabled]), button[role="menuitemradio"]:not([disabled])';

export function getContextMenuItems(menuEl: HTMLElement): HTMLElement[] {
  return Array.from(
    menuEl.querySelectorAll<HTMLElement>(CONTEXT_MENU_ITEM_SELECTOR),
  );
}

function focusContextMenuItem(item: HTMLElement | undefined): void {
  if (!item) return;
  item.focus({ preventScroll: true });
  item.scrollIntoView({ block: "nearest" });
}

function isSuggestionContextMenu(menuEl: HTMLElement): boolean {
  return menuEl.querySelector('[role="listbox"]') != null;
}

function focusFirstContextMenuItem(menuEl: HTMLElement): void {
  focusContextMenuItem(getContextMenuItems(menuEl)[0]);
}

/** Focus the menu root (pointer) or first item (keyboard). Skips suggestion menus. */
export function focusContextMenuOnOpen(
  menuEl: HTMLElement,
  focusFirstItem: boolean,
): void {
  if (isSuggestionContextMenu(menuEl)) return;
  if (focusFirstItem) {
    focusFirstContextMenuItem(menuEl);
    return;
  }
  menuEl.focus({ preventScroll: true });
}

function navigateContextMenuItems(
  items: HTMLElement[],
  current: HTMLElement,
  direction: 1 | -1,
): void {
  const index = items.indexOf(current);
  if (index < 0) {
    focusContextMenuItem(direction === 1 ? items[0] : items[items.length - 1]);
    return;
  }
  const next = items[index + direction];
  if (next) focusContextMenuItem(next);
}

export function handleContextMenuKeyDown(
  e: { key: string; preventDefault: () => void; stopPropagation: () => void },
  menuEl: HTMLElement,
  target: EventTarget | null,
): boolean {
  if (!(target instanceof HTMLElement) || !menuEl.contains(target)) return false;
  if (isSuggestionContextMenu(menuEl)) return false;

  const items = getContextMenuItems(menuEl);
  if (items.length === 0) return false;

  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      e.stopPropagation();
      navigateContextMenuItems(items, target, 1);
      return true;
    case "ArrowUp":
      e.preventDefault();
      e.stopPropagation();
      navigateContextMenuItems(items, target, -1);
      return true;
    case "Home":
      e.preventDefault();
      e.stopPropagation();
      focusContextMenuItem(items[0]);
      return true;
    case "End":
      e.preventDefault();
      e.stopPropagation();
      focusContextMenuItem(items[items.length - 1]);
      return true;
    default:
      return false;
  }
}

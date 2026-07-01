// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  focusFirstContextMenuItem,
  getContextMenuItems,
  handleContextMenuKeyDown,
} from "./contextMenuKeyboard";

function buildMenu() {
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" role="menuitem">First</button>
    <div class="context-menu__separator" role="separator"></div>
    <p class="context-menu__heading">Section</p>
    <button type="button" role="menuitemcheckbox">Toggle</button>
    <button type="button" role="menuitem" disabled>Disabled</button>
    <button type="button" role="menuitemradio">Option</button>
  `;
  document.body.appendChild(menu);
  return menu;
}

describe("contextMenuKeyboard", () => {
  it("collects enabled menu items and skips separators, headings, and disabled items", () => {
    const menu = buildMenu();
    const items = getContextMenuItems(menu);
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "First",
      "Toggle",
      "Option",
    ]);
    menu.remove();
  });

  it("moves focus with arrow keys", () => {
    const menu = buildMenu();
    const items = getContextMenuItems(menu);
    items[0]!.focus();

    const down = {
      key: "ArrowDown",
      preventDefault: () => {},
      stopPropagation: () => {},
    };
    expect(handleContextMenuKeyDown(down, menu, items[0]!)).toBe(true);
    expect(document.activeElement).toBe(items[1]);

    const up = {
      key: "ArrowUp",
      preventDefault: () => {},
      stopPropagation: () => {},
    };
    expect(handleContextMenuKeyDown(up, menu, items[1]!)).toBe(true);
    expect(document.activeElement).toBe(items[0]);
    menu.remove();
  });

  it("focuses the first item when a menu opens", () => {
    const menu = buildMenu();
    focusFirstContextMenuItem(menu);
    expect(document.activeElement).toBe(getContextMenuItems(menu)[0]);
    menu.remove();
  });

  it("ignores suggestion menus that use a listbox", () => {
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <div role="listbox">
        <button type="button" role="option">One</button>
      </div>
    `;
    document.body.appendChild(menu);
    const option = menu.querySelector('[role="option"]') as HTMLButtonElement;
    option.focus();

    const handled = handleContextMenuKeyDown(
      {
        key: "ArrowDown",
        preventDefault: () => {},
        stopPropagation: () => {},
      },
      menu,
      option,
    );
    expect(handled).toBe(false);
    menu.remove();
  });
});

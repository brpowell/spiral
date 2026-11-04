import { beforeEach, describe, expect, it, vi } from "vitest";

const items = vi.hoisted(() => new Map<string, { enabled?: boolean }>());

vi.mock("@tauri-apps/api/menu", () => {
  const stub = () => Promise.resolve({ setAsAppMenu: () => Promise.resolve() });
  return {
    Menu: { new: stub },
    PredefinedMenuItem: { new: stub },
    Submenu: { new: stub },
    MenuItem: {
      new: (options: { id: string; enabled?: boolean }) => {
        items.set(options.id, options);
        return Promise.resolve({ setEnabled: () => Promise.resolve() });
      },
    },
  };
});
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));
vi.mock("./appearanceWindow", () => ({ LINKED_PACKS_CHANGED_EVENT: "linked" }));
vi.mock("./appLocale", () => ({ stubLocaleMenuLabel: () => "Stub" }));
vi.mock("./i18n", () => ({ t: (key: string) => key }));
vi.mock("./tauri", () => ({
  listItems: () => Promise.resolve([{ zone: "linked" }]),
}));

import { setupAppMenu, type AppMenuHandlers } from "./appMenu";

const handlers = new Proxy({}, { get: () => () => {} }) as AppMenuHandlers;
const enabledIds = () =>
  [...items].filter(([, item]) => item.enabled !== false).map(([id]) => id);

describe("setupAppMenu", () => {
  beforeEach(() => items.clear());

  it("keeps only the safe items during onboarding", async () => {
    await setupAppMenu(handlers, true);
    expect(enabledIds()).toEqual(
      expect.arrayContaining(["about", "check-for-updates", "activity-logs"]),
    );
    for (const id of [
      "preferences",
      "add-to-library",
      "new-playlist",
      "refresh-library-metadata",
      "fetch-missing-lyrics",
      "skin-mode",
      "appearance",
      "reload-linked-packs",
      "equalizer",
    ]) {
      expect(items.get(id)?.enabled).toBe(false);
    }
  });

  it("enables everything once onboarding is done", async () => {
    await setupAppMenu(handlers, false);
    expect(enabledIds()).toEqual([...items.keys()]);
  });
});

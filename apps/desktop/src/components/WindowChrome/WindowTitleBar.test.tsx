import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppMenuHandlers } from "../../lib/appMenu";
import { WindowTitleBar } from "./WindowTitleBar";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => {}),
    minimize: () => Promise.resolve(),
    toggleMaximize: () => Promise.resolve(),
    close: () => Promise.resolve(),
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

vi.mock("../../lib/appMenu", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/appMenu")>();
  return {
    ...actual,
    linkedPacksAvailable: vi.fn().mockResolvedValue(false),
  };
});

const handlers: AppMenuHandlers = {
  addToLibrary: vi.fn(),
  refreshLibraryMetadata: vi.fn(),
  fetchMissingLyrics: vi.fn(),
  newPlaylist: vi.fn(),
  openPreferences: vi.fn(),
  checkForUpdates: vi.fn(),
  openAbout: vi.fn(),
  openSkinMode: vi.fn(),
  openAppearance: vi.fn(),
  openEqualizer: vi.fn(),
  openActivityLogs: vi.fn(),
  reloadLinkedPacks: vi.fn(),
  quit: vi.fn(),
};

describe("WindowTitleBar", () => {
  it("omits logo text when the app menu is present", () => {
    render(<WindowTitleBar title="Spiral" handlers={handlers} />);

    expect(
      screen.queryByText("Spiral", { selector: ".window-titlebar__title" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Spiral" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "File" })).toBeInTheDocument();
  });

  it("shows the window title when menus are hidden", () => {
    render(<WindowTitleBar title="Equalizer" />);

    expect(screen.getByText("Equalizer")).toHaveClass("window-titlebar__title");
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});

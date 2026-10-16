import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockImport, mockLink, mockReload } = vi.hoisted(() => ({
  mockImport: vi.fn().mockResolvedValue(undefined),
  mockLink: vi.fn().mockResolvedValue(undefined),
  mockReload: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/items/itemActions", () => ({
  importItemWithRefresh: mockImport,
  linkItemFolderWithRefresh: mockLink,
  reloadLinkedItemsWithRefresh: mockReload,
}));
vi.mock("./NewThemeModal", () => ({
  NewThemeModal: ({ open }: { open: boolean }) =>
    open ? <div>new-theme-modal</div> : null,
}));

import { StudioSidebarActions } from "./StudioSidebarActions";

function setup() {
  const runAfterLeavingEditor = vi.fn((go: () => void) => go());
  render(
    <StudioSidebarActions
      runAfterLeavingEditor={runAfterLeavingEditor}
      openThemeEditor={vi.fn()}
    />,
  );
  return { runAfterLeavingEditor };
}

describe("StudioSidebarActions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens the new theme modal from the New menu", () => {
    const { runAfterLeavingEditor } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Create new item" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Theme" }));
    expect(runAfterLeavingEditor).toHaveBeenCalled();
    expect(screen.getByText("new-theme-modal")).toBeTruthy();
  });

  it("runs the item actions from the Manage menu", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Manage items" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Install…" }));
    expect(mockImport).toHaveBeenCalledTimes(1);
  });

  it("lists link and reload entries", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Manage items" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Link a folder…" }));
    expect(mockLink).toHaveBeenCalledTimes(1);
  });
});

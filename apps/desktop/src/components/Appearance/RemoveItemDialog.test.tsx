import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUnlink, mockDelete } = vi.hoisted(() => ({
  mockUnlink: vi.fn(async () => true),
  mockDelete: vi.fn(async () => true),
}));

vi.mock("../../lib/items/itemActions", () => ({
  unlinkItemWithRefresh: mockUnlink,
  deleteLinkedItemWithRefresh: mockDelete,
}));

import { RemoveItemDialog } from "./RemoveItemDialog";

const item = {
  effectiveId: "bryan.theme.noir",
  dir: "/Users/bryan/Music/Spiral Library/Packs/themes/bryan.noir",
  name: "Noir",
};

function renderDialog(onAfterRemove = vi.fn()) {
  const onClose = vi.fn();
  render(
    <RemoveItemDialog
      open
      item={item}
      onClose={onClose}
      onAfterRemove={onAfterRemove}
    />,
  );
  return { onClose, onAfterRemove };
}

describe("RemoveItemDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers unlink and delete, with unlink selected first", () => {
    renderDialog();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0]).toBeChecked();
    expect(radios[1]).not.toBeChecked();
  });

  it("unlinks by default, keeping the folder", async () => {
    const { onClose, onAfterRemove } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    await waitFor(() => expect(onAfterRemove).toHaveBeenCalled());
    expect(mockUnlink).toHaveBeenCalledWith(item.dir, "Noir");
    expect(mockDelete).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("deletes from disk when Delete is chosen", async () => {
    const { onAfterRemove } = renderDialog();
    fireEvent.click(screen.getAllByRole("radio")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onAfterRemove).toHaveBeenCalled());
    expect(mockDelete).toHaveBeenCalledWith("bryan.theme.noir", "Noir");
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it("stays open when the removal fails", async () => {
    mockUnlink.mockResolvedValueOnce(false);
    const { onClose, onAfterRemove } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    await waitFor(() => expect(mockUnlink).toHaveBeenCalled());
    expect(onAfterRemove).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

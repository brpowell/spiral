import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Track } from "@/types/track";
import { RemoveTrackDialog } from "./RemoveTrackDialog";

const track = (id: number, sourceId: number, missingSince?: string) =>
  ({ id, title: `Song ${id}`, sourceId, missingSince }) as Track;

function renderDialog(tracks: Track[]) {
  render(
    <RemoveTrackDialog
      open
      tracks={tracks}
      onClose={vi.fn()}
      onRemove={vi.fn().mockResolvedValue(undefined)}
    />,
  );
}

describe("RemoveTrackDialog", () => {
  it("offers deleting files in any source folder, with no note", () => {
    renderDialog([track(1, 1), track(2, 3)]);
    expect(
      screen.getByRole("button", { name: "Remove and send to trash" }),
    ).toBeTruthy();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("only removes from the library when every track is missing", () => {
    renderDialog([track(1, 1, "then"), track(2, 3, "then")]);
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.queryByRole("button", { name: /trash/i })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Remove from library" }),
    ).toBeTruthy();
  });

  it("still offers the Trash when only some tracks are missing", () => {
    renderDialog([track(1, 1), track(2, 1, "then")]);
    expect(screen.queryByRole("note")).toBeNull();
    // Only the one present file goes to the Trash.
    expect(
      screen.getByRole("button", { name: "Remove and send to trash" }),
    ).toBeTruthy();
  });
});

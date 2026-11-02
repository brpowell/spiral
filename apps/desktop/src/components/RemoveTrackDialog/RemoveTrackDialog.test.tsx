import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Track } from "../../types/track";
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

  it("says which of Other's files will be kept on disk in a mixed selection", () => {
    renderDialog([track(1, 1), track(2, 3), track(3, 2), track(4, 2)]);
    expect(screen.getByRole("note").textContent).toBe(
      "2 of these files are in Other files. They leave the library, but stay on disk.",
    );
    expect(
      screen.getByRole("button", { name: "Remove and send to trash" }),
    ).toBeTruthy();
  });

  it("only removes from the library when every file is in Other", () => {
    renderDialog([track(1, 2), track(2, 2)]);
    expect(screen.getByRole("note").textContent).toMatch(
      /^These files are in Other files/,
    );
    expect(screen.queryByRole("button", { name: /delete/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Remove from library" }),
    ).toBeTruthy();
  });

  it("only removes from the library when every track is missing", () => {
    renderDialog([track(1, 1, "then"), track(2, 3, "then")]);
    expect(screen.getByRole("note").textContent).toMatch(
      /^These tracks are missing, so they're only removed from the library/,
    );
    expect(screen.queryByRole("button", { name: /trash/i })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Remove from library" }),
    ).toBeTruthy();
  });

  it("says missing tracks are only removed in a mixed selection", () => {
    renderDialog([track(1, 1), track(2, 1, "then"), track(3, 2)]);
    const notes = screen.getAllByRole("note").map((n) => n.textContent);
    expect(notes).toEqual([
      "1 of these files is in Other files. It leaves the library, but stays on disk.",
      "1 of these tracks is missing, so it's only removed from the library. Spiral won't delete a file it can't find.",
    ]);
    // Only the one present file outside Other goes to the Trash.
    expect(
      screen.getByRole("button", { name: "Remove and send to trash" }),
    ).toBeTruthy();
  });
});

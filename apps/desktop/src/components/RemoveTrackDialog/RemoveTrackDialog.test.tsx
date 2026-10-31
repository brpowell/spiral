import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Track } from "../../types/track";
import { RemoveTrackDialog } from "./RemoveTrackDialog";

const track = (id: number, sourceId: number) =>
  ({ id, title: `Song ${id}`, sourceId }) as Track;

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
      screen.getByRole("button", { name: "Remove and delete files" }),
    ).toBeTruthy();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("says which of Other's files will be kept on disk in a mixed selection", () => {
    renderDialog([track(1, 1), track(2, 3), track(3, 2), track(4, 2)]);
    expect(screen.getByRole("note").textContent).toBe(
      "2 of these files aren't in the Spiral library. They leave the library, but stay on disk.",
    );
    expect(
      screen.getByRole("button", { name: "Remove and delete files" }),
    ).toBeTruthy();
  });

  it("only removes from the library when every file is in Other", () => {
    renderDialog([track(1, 2), track(2, 2)]);
    expect(screen.getByRole("note").textContent).toMatch(
      /^These files aren't in the Spiral library/,
    );
    expect(screen.queryByRole("button", { name: /delete/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Remove from library" }),
    ).toBeTruthy();
  });
});

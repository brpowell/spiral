import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSourcesStore } from "../../store/useSourcesStore";
import type { Source } from "../../types/source";
import type { Track } from "../../types/track";
import { RemoveTrackDialog } from "./RemoveTrackDialog";

const watched: Source = {
  id: 3,
  kind: "watched",
  rootPath: "/Music",
  name: "Music",
  writable: true,
  createdAt: "2026-01-01T00:00:00Z",
};

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
  beforeEach(() => {
    useSourcesStore.setState({ sourcesById: new Map([[3, watched]]) });
  });

  it("offers deleting files Spiral owns, with no note", () => {
    renderDialog([track(1, 1)]);
    expect(
      screen.getByRole("button", { name: "Remove and delete file" }),
    ).toBeTruthy();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("says which files will be kept on disk in a mixed selection", () => {
    renderDialog([track(1, 1), track(2, 3), track(3, 2)]);
    expect(screen.getByRole("note").textContent).toBe(
      "2 of these files aren't in the Spiral library. They leave the library, but stay on disk.",
    );
    expect(
      screen.getByRole("button", { name: "Remove and delete file" }),
    ).toBeTruthy();
  });

  it("only removes from the library when no file is Spiral's", () => {
    renderDialog([track(1, 3), track(2, 2)]);
    expect(screen.getByRole("note").textContent).toMatch(
      /^These files aren't in the Spiral library/,
    );
    expect(screen.queryByRole("button", { name: /delete/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Remove from library" }),
    ).toBeTruthy();
  });
});

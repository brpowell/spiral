import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePlaylistStore } from "../../store/usePlaylistStore";
import type { Playlist } from "../../types/playlist";
import { Sidebar } from "./Sidebar";

const openPlaylistEditor = vi.fn();

function setup(playlists: Playlist[] = []) {
  usePlaylistStore.setState({ playlists, openPlaylistEditor });
  render(<Sidebar />);
}

const playlist: Playlist = {
  id: 1,
  title: "Road Trip",
  description: null,
  dateCreated: "2026-01-01",
  lastUsedAt: "2026-01-01",
  trackIds: [],
  imageMode: "generated",
  customImagePath: null,
  coverBackground: null,
  coverBackgroundEnd: null,
  coverIcon: null,
};

describe("Sidebar", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists More directly after the library views", () => {
    setup();
    const labels = within(screen.getByRole("navigation"))
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(labels).toEqual(["Tracks", "Albums", "Artists", "More"]);
  });

  it("has no New Playlist button", () => {
    setup();
    expect(screen.queryByRole("button", { name: /New Playlist/ })).toBeNull();
  });

  it("creates a playlist from the Playlists section context menu", () => {
    setup();
    fireEvent.contextMenu(screen.getByRole("region", { name: "Playlists" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "New Playlist…" }));
    expect(openPlaylistEditor).toHaveBeenCalledWith("new");
  });

  it("creates a playlist from a playlist's own context menu", () => {
    setup([playlist]);
    fireEvent.contextMenu(screen.getByText("Road Trip"));
    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "New Playlist…" }));
    expect(openPlaylistEditor).toHaveBeenCalledWith("new");
  });
});

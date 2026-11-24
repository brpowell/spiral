import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Genre } from "@/lib/genres/genres";
import { usePlaylistStore } from "@/store/usePlaylistStore";
import { usePlayerStore } from "@/store/usePlayerStore";
import type { Playlist } from "@/types/playlist";
import type { Track } from "@/types/track";
import { useGenreEditMenu } from "./useGenreEditMenu";

const genre: Genre = {
  key: "rock",
  name: "Rock",
  tracks: [{ id: "7" }, { id: "3" }, { id: "9" }] as Track[],
};

function Harness({ value }: { value: Genre }) {
  const { onContextMenu, contextMenu } = useGenreEditMenu(value);
  return (
    <>
      <div data-testid="card" onContextMenu={onContextMenu} />
      {contextMenu}
    </>
  );
}

function openMenu() {
  fireEvent.contextMenu(screen.getByTestId("card"), {
    clientX: 10,
    clientY: 10,
  });
}

describe("useGenreEditMenu", () => {
  const playTracks = vi.fn();
  const addToQueue = vi.fn();
  const openGenreEditor = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    usePlayerStore.setState({ playTracks, addToQueue, openGenreEditor });
  });

  it("plays the whole genre starting from its first track", () => {
    render(<Harness value={genre} />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Play All" }));
    expect(playTracks).toHaveBeenCalledWith(["7", "3", "9"], "7");
  });

  it("queues the genre's tracks", () => {
    render(<Harness value={genre} />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Add .*Queue/ }));
    expect(addToQueue).toHaveBeenCalledWith(["7", "3", "9"]);
  });

  it("opens the genre editor for the genre's key", () => {
    render(<Harness value={genre} />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit Genre" }));
    expect(openGenreEditor).toHaveBeenCalledWith("rock");
  });

  it("hides play and queue for a genre without tracks", () => {
    render(<Harness value={{ ...genre, tracks: [] }} />);
    openMenu();
    expect(screen.getByRole("menuitem", { name: "Edit Genre" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Play All" })).toBeNull();
  });

  it("adds all of the genre's tracks to a chosen playlist", async () => {
    const addTracksToPlaylist = vi.fn().mockResolvedValue(undefined);
    usePlayerStore.setState({ library: genre.tracks });
    usePlaylistStore.setState({
      playlists: [
        { id: "9", title: "Mix", trackIds: [] } as unknown as Playlist,
      ],
      addTracksToPlaylist,
    });
    render(<Harness value={genre} />);
    openMenu();
    fireEvent.mouseEnter(
      screen.getByRole("menuitem", { name: /Add to Playlist/ }).parentElement!,
    );
    fireEvent.click(screen.getAllByRole("menuitem", { name: "Mix" })[0]);
    await waitFor(() =>
      expect(addTracksToPlaylist).toHaveBeenCalledWith("9", ["7", "3", "9"]),
    );
  });
});

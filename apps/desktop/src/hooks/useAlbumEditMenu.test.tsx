import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "@/store/usePlayerStore";
import { usePlaylistStore } from "@/store/usePlaylistStore";
import type { Album } from "@/types/album";
import type { Playlist } from "@/types/playlist";
import type { Track } from "@/types/track";
import { useAlbumEditMenu } from "./useAlbumEditMenu";

const album = {
  key: "a",
  title: "A",
  tracks: [{ id: 4 }, { id: 5 }] as Track[],
} as Album;

function Harness({ value }: { value: Album }) {
  const { onContextMenu, contextMenu } = useAlbumEditMenu(value);
  return (
    <>
      <div data-testid="card" onContextMenu={onContextMenu} />
      {contextMenu}
    </>
  );
}

describe("useAlbumEditMenu play all", () => {
  it("plays the whole album from its first track", () => {
    const playTracks = vi.fn();
    usePlayerStore.setState({ playTracks });
    render(<Harness value={album} />);
    fireEvent.contextMenu(screen.getByTestId("card"), {
      clientX: 10,
      clientY: 10,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Play All" }));
    expect(playTracks).toHaveBeenCalledWith([4, 5], 4);
  });
});

describe("useAlbumEditMenu add to playlist", () => {
  const addTracksToPlaylist = vi.fn().mockResolvedValue(undefined);
  const openPlaylistEditor = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    usePlayerStore.setState({ library: album.tracks });
    usePlaylistStore.setState({
      playlists: [{ id: 9, title: "Mix", trackIds: [] } as unknown as Playlist],
      addTracksToPlaylist,
      openPlaylistEditor,
    });
  });

  function openSubmenu() {
    render(<Harness value={album} />);
    fireEvent.contextMenu(screen.getByTestId("card"), {
      clientX: 10,
      clientY: 10,
    });
    fireEvent.mouseEnter(
      screen.getByRole("menuitem", { name: /Add to Playlist/ }).parentElement!,
    );
  }

  it("adds every album track to the chosen playlist", async () => {
    openSubmenu();
    fireEvent.click(screen.getAllByRole("menuitem", { name: "Mix" })[0]);
    await waitFor(() =>
      expect(addTracksToPlaylist).toHaveBeenCalledWith(9, [4, 5]),
    );
  });

  it("starts a new playlist seeded with the album's tracks", () => {
    openSubmenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /New Playlist/ }));
    expect(openPlaylistEditor).toHaveBeenCalledWith("new", [4, 5]);
  });

  it("omits the submenu for an album without tracks", () => {
    render(<Harness value={{ ...album, tracks: [] }} />);
    fireEvent.contextMenu(screen.getByTestId("card"), {
      clientX: 10,
      clientY: 10,
    });
    expect(
      screen.queryByRole("menuitem", { name: /Add to Playlist/ }),
    ).toBeNull();
  });
});

describe("remove from library", () => {
  it("confirms, then removes every track from the library", async () => {
    const removeTracksFromLibrary = vi.fn().mockResolvedValue(undefined);
    usePlayerStore.setState({ removeTracksFromLibrary });
    render(<Harness value={album} />);
    fireEvent.contextMenu(screen.getByTestId("card"), {
      clientX: 10,
      clientY: 10,
    });
    fireEvent.click(
      screen.getByRole("menuitem", { name: /Remove .* from Library/ }),
    );
    expect(removeTracksFromLibrary).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove from library" }),
    );
    await waitFor(() =>
      expect(removeTracksFromLibrary).toHaveBeenCalledWith([4, 5], false),
    );
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePlaylistStore } from "@/store/usePlaylistStore";
import { usePlayerStore } from "@/store/usePlayerStore";
import type { Artist } from "@/types/artist";
import type { Playlist } from "@/types/playlist";
import type { Track } from "@/types/track";
import { useArtistEditMenu } from "./useArtistEditMenu";

const artist = {
  key: "a",
  name: "A",
  tracks: [{ id: 7 }, { id: 3 }] as Track[],
} as Artist;

function Harness({ value }: { value: Artist }) {
  const { onContextMenu, contextMenu } = useArtistEditMenu(
    value,
    "discography",
  );
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

describe("useArtistEditMenu", () => {
  const playTracks = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    usePlayerStore.setState({ playTracks });
  });

  it("plays all of the artist's tracks from the first", () => {
    render(<Harness value={artist} />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Play All" }));
    expect(playTracks).toHaveBeenCalledWith([7, 3], 7);
  });

  it("hides play all for an artist without tracks", () => {
    render(<Harness value={{ ...artist, tracks: [] }} />);
    openMenu();
    expect(screen.queryByRole("menuitem", { name: "Play All" })).toBeNull();
  });

  it("adds all of the artist's tracks to a chosen playlist", async () => {
    const addTracksToPlaylist = vi.fn().mockResolvedValue(undefined);
    usePlayerStore.setState({ library: artist.tracks });
    usePlaylistStore.setState({
      playlists: [{ id: 9, title: "Mix", trackIds: [] } as unknown as Playlist],
      addTracksToPlaylist,
    });
    render(<Harness value={artist} />);
    openMenu();
    fireEvent.mouseEnter(
      screen.getByRole("menuitem", { name: /Add to Playlist/ }).parentElement!,
    );
    fireEvent.click(screen.getAllByRole("menuitem", { name: "Mix" })[0]);
    await waitFor(() =>
      expect(addTracksToPlaylist).toHaveBeenCalledWith(9, [7, 3]),
    );
  });
});

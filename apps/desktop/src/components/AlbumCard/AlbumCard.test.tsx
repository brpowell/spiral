import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useNavigationStore } from "@/store/useNavigationStore";
import type { Album } from "@/types/album";
import { AlbumCard } from "./AlbumCard";

const album: Album = {
  key: "Abbey Road\0The Beatles",
  title: "Abbey Road",
  artist: "The Beatles",
  year: 1969,
  artPath: null,
  tracks: [],
};

describe("AlbumCard", () => {
  beforeEach(() => {
    useNavigationStore.setState({ albumKey: null, artistKey: null });
  });

  it("opens the album when the title area is clicked", () => {
    render(<AlbumCard album={album} artistKey="the beatles" />);

    fireEvent.click(screen.getByRole("button", { name: /Abbey Road/ }));

    expect(useNavigationStore.getState().albumKey).toBe(album.key);
    expect(useNavigationStore.getState().artistKey).toBeNull();
  });

  it("opens the artist, not the album, when the artist name is clicked", () => {
    render(<AlbumCard album={album} artistKey="the beatles" />);

    fireEvent.click(
      screen.getByRole("button", { name: "View artist The Beatles" }),
    );

    expect(useNavigationStore.getState().artistKey).toBe("the beatles");
    expect(useNavigationStore.getState().albumKey).toBeNull();
  });

  it("renders the artist as plain text when it has no artist page", () => {
    render(<AlbumCard album={album} artistKey={null} />);

    expect(screen.getByText("The Beatles").tagName).toBe("SPAN");
    expect(screen.queryByRole("button", { name: /View artist/ })).toBeNull();
  });
});

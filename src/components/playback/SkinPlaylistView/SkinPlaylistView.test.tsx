import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SKIN_PLAYLIST_SOURCE_ALL,
  SKIN_PLAYLIST_SOURCE_UP_NEXT,
} from "../../../lib/skinPlaylist";
import { usePlayerStore } from "../../../store/usePlayerStore";
import { useSkinStore } from "../../../store/useSkinStore";
import type { Track } from "../../../types/track";
import type { PlaylistNode } from "../../../types/skin";
import { SkinPlaylistView } from "./SkinPlaylistView";

vi.mock("../../EntityArt/useEntityArtSrc", () => ({
  useEntityArtSrc: (path: string | null) => (path ? "asset://thumb" : null),
}));

function track(overrides: Partial<Track> & Pick<Track, "id">): Track {
  return {
    title: "Airbag",
    artist: "Radiohead",
    album: "OK Computer",
    albumArtist: "Radiohead",
    trackNumber: 1,
    totalTracks: null,
    discNumber: 1,
    totalDiscs: null,
    year: 1997,
    genre: null,
    durationSeconds: 240,
    sampleRate: null,
    bitrate: null,
    codec: null,
    filePath: "/library/airbag.mp3",
    artPath: "/library/art/ok-computer.jpg",
    dateAdded: "2024-01-01",
    playCount: 0,
    lastPlayedAt: null,
    rating: 0,
    ...overrides,
  };
}

afterEach(() => {
  useSkinStore.getState().setPlaylistSource(SKIN_PLAYLIST_SOURCE_ALL);
  usePlayerStore.setState({
    library: [],
    currentTrackId: null,
    playbackState: "stopped",
  });
});

function playlistNode(overrides: Partial<PlaylistNode> = {}): PlaylistNode {
  return { type: "playlist", ...overrides };
}

describe("SkinPlaylistView", () => {
  it("applies defaultSource on mount", () => {
    expect(useSkinStore.getState().playlistSourceId).toBe(
      SKIN_PLAYLIST_SOURCE_ALL,
    );

    render(
      <SkinPlaylistView node={playlistNode({ defaultSource: "upNext" })} />,
    );

    expect(useSkinStore.getState().playlistSourceId).toBe(
      SKIN_PLAYLIST_SOURCE_UP_NEXT,
    );
  });

  it("leaves the store default when defaultSource is omitted", () => {
    render(<SkinPlaylistView node={playlistNode()} />);

    expect(useSkinStore.getState().playlistSourceId).toBe(
      SKIN_PLAYLIST_SOURCE_ALL,
    );
  });

  it("opts the playlist out of canvas window drag", () => {
    const { container } = render(<SkinPlaylistView node={playlistNode()} />);

    expect(container.firstChild).toHaveAttribute(
      "data-skin-drag-region",
      "false",
    );
  });

  it("hides row artwork by default", () => {
    usePlayerStore.setState({ library: [track({ id: 1 })] });
    const { container } = render(<SkinPlaylistView node={playlistNode()} />);

    expect(
      container.querySelector(".skin-playlist-view__art"),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector(".skin-playlist-view__row--with-art"),
    ).not.toBeInTheDocument();
  });

  it("applies declared playlist style as inline CSS", () => {
    const { container } = render(
      <SkinPlaylistView
        node={playlistNode({
          style: {
            backgroundColor: "rgb(0, 0, 0)",
            color: "rgb(183, 192, 219)",
            fontSize: 11,
          },
        })}
      />,
    );

    expect(container.querySelector(".skin-playlist-view")).toHaveStyle({
      backgroundColor: "rgb(0, 0, 0)",
      color: "rgb(183, 192, 219)",
      fontSize: "11px",
    });
  });

  it("applies playingRowStyle as inline CSS on the playing row only", () => {
    usePlayerStore.setState({
      library: [track({ id: 1 }), track({ id: 2, title: "Paranoid Android" })],
      currentTrackId: 1,
      playbackState: "playing",
    });
    const { container } = render(
      <SkinPlaylistView
        node={playlistNode({
          playingRowStyle: {
            color: "rgb(255, 255, 255)",
            backgroundColor: "rgb(54, 145, 8)",
          },
        })}
      />,
    );

    const rows = container.querySelectorAll(".skin-playlist-view__row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveClass("skin-playlist-view__row--playing");
    expect(rows[0]).toHaveStyle({
      color: "rgb(255, 255, 255)",
      backgroundColor: "rgb(54, 145, 8)",
    });
    expect(rows[1]).not.toHaveClass("skin-playlist-view__row--playing");
    expect(rows[1]).not.toHaveStyle({
      color: "rgb(255, 255, 255)",
      backgroundColor: "rgb(54, 145, 8)",
    });
  });

  it("does not apply playingRowStyle when the current track is paused", () => {
    usePlayerStore.setState({
      library: [track({ id: 1 })],
      currentTrackId: 1,
      playbackState: "paused",
    });
    const { container } = render(
      <SkinPlaylistView
        node={playlistNode({
          playingRowStyle: {
            color: "rgb(255, 255, 255)",
            backgroundColor: "rgb(54, 145, 8)",
          },
        })}
      />,
    );

    const row = container.querySelector(".skin-playlist-view__row");
    expect(row).toHaveClass("skin-playlist-view__row--current");
    expect(row).not.toHaveClass("skin-playlist-view__row--playing");
    expect(row).not.toHaveStyle({
      color: "rgb(255, 255, 255)",
      backgroundColor: "rgb(54, 145, 8)",
    });
  });

  it("applies currentRowStyle as inline CSS on the current row when paused", () => {
    usePlayerStore.setState({
      library: [track({ id: 1 }), track({ id: 2, title: "Paranoid Android" })],
      currentTrackId: 1,
      playbackState: "paused",
    });
    const { container } = render(
      <SkinPlaylistView
        node={playlistNode({
          currentRowStyle: { color: "rgb(215, 255, 154)" },
        })}
      />,
    );

    const rows = container.querySelectorAll(".skin-playlist-view__row");
    expect(rows[0]).toHaveClass("skin-playlist-view__row--current");
    expect(rows[0]).not.toHaveClass("skin-playlist-view__row--playing");
    expect(rows[0]).toHaveStyle({ color: "rgb(215, 255, 154)" });
    expect(rows[1]).not.toHaveClass("skin-playlist-view__row--current");
    expect(rows[1]).not.toHaveStyle({ color: "rgb(215, 255, 154)" });
  });

  it("applies currentRowStyle on the playing row when playingRowStyle is omitted", () => {
    usePlayerStore.setState({
      library: [track({ id: 1 })],
      currentTrackId: 1,
      playbackState: "playing",
    });
    const { container } = render(
      <SkinPlaylistView
        node={playlistNode({
          currentRowStyle: { color: "rgb(215, 255, 154)" },
        })}
      />,
    );

    const row = container.querySelector(".skin-playlist-view__row");
    expect(row).toHaveClass("skin-playlist-view__row--playing");
    expect(row).toHaveStyle({ color: "rgb(215, 255, 154)" });
  });

  it("applies currentRowStyle on the playing row and lets playingRowStyle win conflicts", () => {
    usePlayerStore.setState({
      library: [track({ id: 1 })],
      currentTrackId: 1,
      playbackState: "playing",
    });
    const { container } = render(
      <SkinPlaylistView
        node={playlistNode({
          currentRowStyle: { color: "rgb(215, 255, 154)" },
          playingRowStyle: {
            color: "rgb(255, 255, 255)",
            backgroundColor: "rgb(54, 145, 8)",
          },
        })}
      />,
    );

    const row = container.querySelector(".skin-playlist-view__row");
    expect(row).toHaveClass("skin-playlist-view__row--current");
    expect(row).toHaveClass("skin-playlist-view__row--playing");
    expect(row).toHaveStyle({
      color: "rgb(255, 255, 255)",
      backgroundColor: "rgb(54, 145, 8)",
    });
  });

  it("renders row artwork when showArtwork is true", () => {
    usePlayerStore.setState({ library: [track({ id: 1 })] });
    const { container } = render(
      <SkinPlaylistView node={playlistNode({ showArtwork: true })} />,
    );

    expect(
      container.querySelector(".skin-playlist-view__row--with-art"),
    ).toBeInTheDocument();
    expect(
      container.querySelector(".skin-playlist-view__art-img"),
    ).toHaveAttribute("src", "asset://thumb");
  });
});

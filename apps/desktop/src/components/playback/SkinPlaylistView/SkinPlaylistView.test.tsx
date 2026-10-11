import { fireEvent, render } from "@testing-library/react";
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

vi.mock("../../../lib/skinNodeStyle", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../lib/skinNodeStyle")>();
  return {
    ...actual,
    useResolvedNodeStyle: (style: unknown) => style,
  };
});

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
  useSkinStore.getState().setPlaylistFilter("");
  usePlayerStore.setState({
    library: [],
    currentTrackId: null,
    playbackState: "stopped",
  });
  vi.restoreAllMocks();
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

  it("applies sourceStyle and merges sourceHoverStyle on hover", () => {
    const { container } = render(
      <SkinPlaylistView
        node={playlistNode({
          sourceStyle: { backgroundColor: "rgb(10, 18, 0)" },
          sourceHoverStyle: { backgroundColor: "rgb(20, 32, 0)" },
        })}
      />,
    );

    const wrap = container.querySelector(".skin-playlist-view__source-wrap");
    const source = container.querySelector(".skin-playlist-view__source");
    expect(source).toHaveStyle({ backgroundColor: "rgb(10, 18, 0)" });

    fireEvent.mouseEnter(wrap!);
    expect(source).toHaveStyle({ backgroundColor: "rgb(20, 32, 0)" });

    fireEvent.mouseLeave(wrap!);
    expect(source).toHaveStyle({ backgroundColor: "rgb(10, 18, 0)" });
  });

  it("applies rowHoverStyle on hover under current/playing paint", () => {
    usePlayerStore.setState({
      library: [track({ id: 1 }), track({ id: 2, title: "Paranoid Android" })],
      currentTrackId: 1,
      playbackState: "paused",
    });
    const { container } = render(
      <SkinPlaylistView
        node={playlistNode({
          currentRowStyle: { color: "rgb(238, 255, 102)" },
          rowHoverStyle: { backgroundColor: "rgba(204, 255, 0, 0.12)" },
        })}
      />,
    );

    const rows = container.querySelectorAll(".skin-playlist-view__row");
    fireEvent.mouseEnter(rows[1]!);
    expect(rows[1]).toHaveStyle({
      backgroundColor: "rgba(204, 255, 0, 0.12)",
    });
    expect(rows[1]).not.toHaveStyle({ color: "rgb(238, 255, 102)" });

    fireEvent.mouseEnter(rows[0]!);
    expect(rows[0]).toHaveStyle({
      color: "rgb(238, 255, 102)",
      backgroundColor: "rgba(204, 255, 0, 0.12)",
    });
  });

  it("renders source options instead of tracks when items is sources", () => {
    usePlayerStore.setState({ library: [track({ id: 1 })] });
    useSkinStore.getState().setPlaylistSource(SKIN_PLAYLIST_SOURCE_UP_NEXT);
    const { container } = render(
      <SkinPlaylistView
        node={playlistNode({
          items: "sources",
          showDropdown: true,
          showDuration: true,
        })}
      />,
    );

    expect(container.querySelector(".skin-playlist-view")).toHaveAttribute(
      "data-playlist-items",
      "sources",
    );
    expect(
      container.querySelector(".skin-playlist-view__source"),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector(".skin-playlist-view__duration"),
    ).not.toBeInTheDocument();

    const rows = container.querySelectorAll(".skin-playlist-view__row");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]).toHaveTextContent("All tracks");
    expect(rows[1]).toHaveTextContent("Up Next");
    expect(rows[1]).toHaveClass("skin-playlist-view__row--current");

    fireEvent.click(rows[0]!);
    expect(useSkinStore.getState().playlistSourceId).toBe(
      SKIN_PLAYLIST_SOURCE_ALL,
    );
  });

  it("plays the full source when a filtered row is clicked", () => {
    const playTracks = vi
      .spyOn(usePlayerStore.getState(), "playTracks")
      .mockResolvedValue(undefined);
    usePlayerStore.setState({
      library: [
        track({ id: 1, title: "Airbag" }),
        track({ id: 2, title: "Paranoid Android" }),
      ],
    });
    useSkinStore.getState().setPlaylistFilter("air");
    const { container } = render(<SkinPlaylistView node={playlistNode()} />);

    fireEvent.click(container.querySelector(".skin-playlist-view__row")!);

    expect(playTracks).toHaveBeenCalledWith([1, 2], 1);
  });

  it("filters track rows by playlistFilterQuery", () => {
    usePlayerStore.setState({
      library: [
        track({ id: 1, title: "Airbag" }),
        track({ id: 2, title: "Paranoid Android" }),
      ],
    });
    useSkinStore.getState().setPlaylistFilter("air");
    const { container } = render(<SkinPlaylistView node={playlistNode()} />);

    const rows = container.querySelectorAll(".skin-playlist-view__row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Airbag");
  });

  it("does not filter source lists", () => {
    usePlayerStore.setState({ library: [track({ id: 1, title: "Airbag" })] });
    useSkinStore.getState().setPlaylistFilter("air");
    const { container } = render(
      <SkinPlaylistView node={playlistNode({ items: "sources" })} />,
    );

    const rows = container.querySelectorAll(".skin-playlist-view__row");
    expect(rows[0]).toHaveTextContent("All tracks");
    expect(rows[1]).toHaveTextContent("Up Next");
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

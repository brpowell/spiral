import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../../../store/usePlayerStore";
import type { RatingNode } from "../../../types/skin";
import type { Track } from "../../../types/track";
import { SkinRating } from "./SkinRating";

const confirmAndApplyTrackRatings = vi.fn();

vi.mock("../../../lib/applyTrackRating", () => ({
  confirmAndApplyTrackRatings: (...args: unknown[]) =>
    confirmAndApplyTrackRatings(...args),
}));

vi.mock("../../../lib/skinBinds", () => ({
  useSkinControlEnabled: () => true,
  useSkinBindState: () => ({ viewState: {}, hoveredNodeIds: new Set() }),
  evaluateSkinCondition: () => false,
}));

vi.mock("../../../lib/skinTooltips", () => ({
  useSkinTooltip: () => "",
}));

function track(overrides: Partial<Track> & Pick<Track, "id">): Track {
  return {
    title: "Song",
    artist: "Artist",
    album: "Album",
    albumArtist: "Artist",
    trackNumber: 1,
    totalTracks: null,
    discNumber: 1,
    totalDiscs: null,
    year: null,
    genre: null,
    durationSeconds: 180,
    sampleRate: null,
    bitrate: null,
    codec: null,
    filePath: `/library/${overrides.id}.mp3`,
    artPath: null,
    dateAdded: "2024-01-01",
    playCount: 0,
    lastPlayedAt: null,
    rating: 128,
    ...overrides,
  };
}

const node: RatingNode = {
  type: "rating",
  id: "visRatingStars",
  presentation: { kind: "primitive" },
  style: { color: "rgb(245, 166, 35)" },
  enabledWhen: "player.hasTrack",
};

afterEach(() => {
  confirmAndApplyTrackRatings.mockReset();
  usePlayerStore.setState({
    library: [],
    playbackTracks: [],
    currentTrackId: null,
  });
});

beforeEach(() => {
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
});

describe("SkinRating", () => {
  it("shows the current track rating and applies style.color", () => {
    const current = track({ id: 1 });
    usePlayerStore.setState({
      library: [current],
      currentTrackId: 1,
    });

    const { container } = render(<SkinRating node={node} />);
    const root = container.querySelector(".skin-rating");
    expect(root).toHaveAttribute("data-node-id", "visRatingStars");
    expect(root).toHaveStyle({ color: "rgb(245, 166, 35)" });
    expect(root).toHaveAttribute("data-skin-drag-region", "false");
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "5");
  });

  it("disables the control when no track is loaded", () => {
    render(<SkinRating node={node} />);
    expect(screen.getByRole("slider")).toHaveClass("track-rating--disabled");
  });

  it("writes the current track rating on pointer commit", () => {
    const current = track({ id: 1 });
    usePlayerStore.setState({
      library: [current],
      currentTrackId: 1,
    });

    render(<SkinRating node={node} />);
    const slider = screen.getByRole("slider");
    vi.spyOn(slider, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 18,
      right: 100,
      width: 100,
      height: 18,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(slider, { button: 0, clientX: 80, pointerId: 1 });
    fireEvent.pointerUp(slider, { button: 0, clientX: 80, pointerId: 1 });

    expect(confirmAndApplyTrackRatings).toHaveBeenCalledWith(
      [current],
      204,
      expect.any(Function),
      { native: true },
    );
  });
});

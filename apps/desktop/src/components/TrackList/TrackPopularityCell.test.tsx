import { render, screen } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { usePopularityStore } from "@/store/usePopularityStore";
import { POPULARITY_COLUMN_PROFILE } from "@/lib/popularity/profiles";
import { TrackPopularityCell } from "./TrackPopularityCell";

function setScores(scores: [number, number][]) {
  act(() => {
    usePopularityStore.setState({
      scores: { [POPULARITY_COLUMN_PROFILE]: new Map(scores) },
      topScore: {
        [POPULARITY_COLUMN_PROFILE]: Math.max(0, ...scores.map(([, s]) => s)),
      },
    });
  });
}

describe("TrackPopularityCell", () => {
  beforeEach(() => {
    usePopularityStore.setState({ scores: {}, topScore: {} });
  });

  it("names the cell by its score and describes it as private listening", () => {
    setScores([
      [1, 10],
      [2, 2.5],
    ]);
    render(<TrackPopularityCell trackId={2} />);

    const cell = screen.getByRole("img");
    expect(cell.getAttribute("aria-label")).toBe("Popularity: 2.5");
    const description = cell.getAttribute("aria-description") ?? "";
    expect(description).toContain("your own private listening");
    expect(description).toMatch(/internet/i);
  });

  it("shows both in the tooltip too", () => {
    setScores([[1, 4]]);
    render(<TrackPopularityCell trackId={1} />);

    const { title } = screen.getByRole("img");
    expect(title.split("\n")[0]).toBe("Popularity: 4.0");
    expect(title).toContain("your own private listening");
  });

  it("says a track with no score has not been played", () => {
    setScores([[1, 10]]);
    render(<TrackPopularityCell trackId={99} />);

    const cell = screen.getByRole("img");
    expect(cell.getAttribute("aria-label")).toBe("Not played yet");
    expect(cell.title.split("\n")[0]).toBe("Not played yet");
  });

  it("updates when the scores change", () => {
    setScores([[1, 4]]);
    render(<TrackPopularityCell trackId={1} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Popularity: 4.0",
    );

    setScores([[1, 9]]);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Popularity: 9.0",
    );
  });
});

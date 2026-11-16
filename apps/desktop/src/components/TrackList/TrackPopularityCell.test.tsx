import { render, screen } from "@testing-library/react";
import { act, type ReactNode, type Ref } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePopularityStore } from "@/store/usePopularityStore";
import { POPULARITY_COLUMN_PROFILE } from "@/lib/popularity/profiles";
import { TrackPopularityCell } from "./TrackPopularityCell";

vi.mock("framer-motion", () => ({
  useReducedMotion: () => false,
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({
      children,
      ref,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...props
    }: {
      children?: ReactNode;
      ref?: Ref<HTMLDivElement>;
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
    } & React.HTMLAttributes<HTMLDivElement>) => (
      <div ref={ref} {...props}>
        {children}
      </div>
    ),
  },
}));

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
  });

  it("shows the score and explainer in a tooltip on keyboard focus", () => {
    setScores([[1, 4]]);
    render(<TrackPopularityCell trackId={1} />);
    expect(screen.queryByRole("tooltip")).toBeNull();

    act(() => screen.getByRole("img").focus());

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain("Popularity: 4.0");
    expect(tooltip.textContent).toContain("your own private listening");
  });

  it("is a focusable row cell control, so the arrow keys reach it", () => {
    setScores([[1, 4]]);
    render(<TrackPopularityCell trackId={1} />);

    const cell = screen.getByRole("img");
    expect(cell.getAttribute("tabindex")).toBe("-1");
    expect(cell.hasAttribute("data-track-list-cell-control")).toBe(true);
    expect(cell.getAttribute("data-track-list-cell-column")).toBe("popularity");
    expect(cell.hasAttribute("title")).toBe(false);
  });

  it("says a track with no score has not been played", () => {
    setScores([[1, 10]]);
    render(<TrackPopularityCell trackId={99} />);

    const cell = screen.getByRole("img");
    expect(cell.getAttribute("aria-label")).toBe("Not played yet");
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

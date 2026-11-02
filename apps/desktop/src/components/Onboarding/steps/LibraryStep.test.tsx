import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLibrarySettingsStore } from "../../../store/useLibrarySettingsStore";
import { useOnboardingStore } from "../../../store/useOnboardingStore";
import { useSourcesStore } from "../../../store/useSourcesStore";
import type { LibrarySettings } from "../../../types/library";
import type { Source } from "../../../types/source";
import { LibraryStep, NewCollectionDialog } from "./LibraryStep";

const tracksSource: Source = {
  id: 1,
  rootPath: "/Users/me/Music/Spiral/Tracks",
  name: "Tracks",
  autoOrganize: true,
  pathFormat: null,
  importTarget: true,
  createdAt: "2026-01-01T00:00:00Z",
};

describe("LibraryStep", () => {
  beforeEach(() => {
    useOnboardingStore.setState({ musicChoice: null });
    useSourcesStore.setState({ sources: [], sourcesById: new Map() });
    useLibrarySettingsStore.setState({
      settings: { libraryRoot: "/Users/me/Music/Spiral/" } as LibrarySettings,
    });
  });

  it("offers the two answers as radio cards, none picked", () => {
    render(<LibraryStep />);
    const cards = screen.getAllByRole("radio");
    expect(cards.map((c) => c.textContent)).toEqual([
      "I'm starting a new collection",
      "It's already organized, I'll pick the folder(s)",
    ]);
    for (const card of cards) expect(card).not.toBeChecked();
  });

  it("remembers the picked answer", () => {
    render(<LibraryStep />);
    const existing = screen.getByRole("radio", {
      name: "It's already organized, I'll pick the folder(s)",
    });
    fireEvent.click(existing);
    expect(useOnboardingStore.getState().musicChoice).toBe("existing");
    expect(existing).toBeChecked();
  });

  describe("new collection note", () => {
    function renderDialog() {
      const onConfirm = vi.fn();
      render(
        <NewCollectionDialog open onClose={vi.fn()} onConfirm={onConfirm} />,
      );
      return onConfirm;
    }

    it("names the Tracks folder in the Spiral folder", () => {
      useSourcesStore.setState({
        sources: [tracksSource],
        sourcesById: new Map([[1, tracksSource]]),
      });
      const onConfirm = renderDialog();
      expect(
        screen.getByText("/Users/me/Music/Spiral/Tracks"),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Got it" }));
      expect(onConfirm).toHaveBeenCalled();
    });

    it("falls back to Tracks under the Spiral folder before sources load", () => {
      renderDialog();
      expect(
        screen.getByText("/Users/me/Music/Spiral/Tracks"),
      ).toBeInTheDocument();
    });
  });
});

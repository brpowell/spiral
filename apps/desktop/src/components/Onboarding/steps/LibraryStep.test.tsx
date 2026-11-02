import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useLibrarySettingsStore } from "../../../store/useLibrarySettingsStore";
import { useOnboardingStore } from "../../../store/useOnboardingStore";
import { useSourcesStore } from "../../../store/useSourcesStore";
import type { LibrarySettings } from "../../../types/library";
import type { Source } from "../../../types/source";
import { LibraryStep } from "./LibraryStep";

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

  function newCard() {
    return screen.getByRole("radio", { name: /I'm starting a new collection/ });
  }

  it("offers the two answers as radio cards, none picked", () => {
    render(<LibraryStep />);
    const cards = screen.getAllByRole("radio");
    expect(cards).toHaveLength(2);
    expect(newCard()).not.toBeChecked();
    expect(
      screen.getByRole("radio", {
        name: "It's already organized, I'll pick the folder(s)",
      }),
    ).not.toBeChecked();
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

  it("says the new collection goes in the Tracks folder", () => {
    useSourcesStore.setState({
      sources: [tracksSource],
      sourcesById: new Map([[1, tracksSource]]),
    });
    render(<LibraryStep />);
    expect(newCard()).toHaveTextContent(
      "Music will be added to /Users/me/Music/Spiral/Tracks",
    );
  });

  it("falls back to Tracks under the Spiral folder before sources load", () => {
    render(<LibraryStep />);
    expect(newCard()).toHaveTextContent("/Users/me/Music/Spiral/Tracks");
  });
});

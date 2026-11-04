import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLibrarySettingsStore } from "../../../store/useLibrarySettingsStore";
import { useOnboardingStore } from "../../../store/useOnboardingStore";
import type { LibrarySettings } from "../../../types/library";
import { LibraryStep } from "./LibraryStep";

const path = vi.hoisted(() => ({ homeDir: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => path);
path.homeDir.mockResolvedValue("/Users/me");

describe("LibraryStep", () => {
  beforeEach(() => {
    useOnboardingStore.setState({ musicChoice: null });
    useLibrarySettingsStore.setState({
      settings: {
        libraryRoot: "/Users/me/Music/Spiral",
        mediaFolder: "/Users/me/Music/Spiral/Tracks",
      } as LibrarySettings,
    });
  });

  function newCard() {
    return screen.getByRole("radio", { name: /^Use the default/ });
  }

  it("offers the two answers as radio cards, none picked", () => {
    render(<LibraryStep />);
    const cards = screen.getAllByRole("radio");
    expect(cards).toHaveLength(2);
    expect(newCard()).not.toBeChecked();
    expect(
      screen.getByRole("radio", {
        name: /^I'll pick the folder\(s\)/,
      }),
    ).not.toBeChecked();
  });

  it("remembers the picked answer", () => {
    render(<LibraryStep />);
    const existing = screen.getByRole("radio", {
      name: /^I'll pick the folder\(s\)/,
    });
    fireEvent.click(existing);
    expect(useOnboardingStore.getState().musicChoice).toBe("existing");
    expect(existing).toBeChecked();
  });

  it("says the new collection goes in the Tracks folder, home as ~", async () => {
    render(<LibraryStep />);
    await waitFor(() =>
      expect(newCard()).toHaveAccessibleDescription(
        "Auto-organize your files under ~/Music/Spiral/Tracks",
      ),
    );
  });

  it("explains when to pick folders", () => {
    render(<LibraryStep />);
    expect(
      screen.getByRole("radio", { name: "I'll pick the folder(s)" }),
    ).toHaveAccessibleDescription(/^If you want more control/);
  });
});

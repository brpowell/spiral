import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLibrarySettingsStore } from "../../../store/useLibrarySettingsStore";
import type {
  LibraryDestinationInfo,
  LibrarySettings,
} from "../../../types/library";
import { LibraryStep } from "./LibraryStep";

const tauri = vi.hoisted(() => ({
  getLibrary: vi.fn(),
  pickLibraryFolder: vi.fn(),
  inspectLibraryDestination: vi.fn(),
  relocateLibrary: vi.fn(),
}));

vi.mock("../../../lib/tauri", () => tauri);
vi.mock("../../../lib/libraryRelocatePlayback", () => ({
  stopPlaybackForLibraryRelocate: vi.fn(),
}));
vi.mock("../../../store/usePlayerStore", () => ({
  usePlayerStore: { getState: () => ({ loadLibrary: vi.fn() }) },
}));
vi.mock("../../../store/usePlaylistStore", () => ({
  usePlaylistStore: { getState: () => ({ loadPlaylists: vi.fn() }) },
}));
vi.mock("../../../store/useArtistImageStore", () => ({
  useArtistImageStore: { getState: () => ({ loadArtistImages: vi.fn() }) },
}));

function destination(
  patch: Partial<LibraryDestinationInfo> = {},
): LibraryDestinationInfo {
  return {
    path: "/Volumes/Music/Spiral",
    hasDatabase: false,
    audioFileCount: 0,
    blockedReason: null,
    ...patch,
  };
}

describe("LibraryStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLibrarySettingsStore.setState({
      settings: {
        libraryRoot: "/Users/me/Music/Spiral Library",
      } as LibrarySettings,
    });
    tauri.pickLibraryFolder.mockResolvedValue("/Volumes/Music/Spiral");
    tauri.relocateLibrary.mockResolvedValue({
      libraryRoot: "/Volumes/Music/Spiral",
    });
  });

  async function change() {
    render(<LibraryStep />);
    fireEvent.click(screen.getByRole("button", { name: "Change location" }));
  }

  it("opens the picker at the current library location", async () => {
    tauri.getLibrary.mockResolvedValue([]);
    tauri.inspectLibraryDestination.mockResolvedValue(destination());
    await change();
    await waitFor(() =>
      expect(tauri.pickLibraryFolder).toHaveBeenCalledWith(
        "/Users/me/Music/Spiral Library",
      ),
    );
  });

  it("moves an empty library without asking move-or-fresh", async () => {
    tauri.getLibrary.mockResolvedValue([]);
    tauri.inspectLibraryDestination.mockResolvedValue(destination());
    await change();
    await waitFor(() =>
      expect(tauri.relocateLibrary).toHaveBeenCalledWith(
        "/Volumes/Music/Spiral",
        "move",
      ),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("switches to an existing library found there", async () => {
    tauri.getLibrary.mockResolvedValue([]);
    tauri.inspectLibraryDestination.mockResolvedValue(
      destination({ hasDatabase: true }),
    );
    await change();
    await waitFor(() =>
      expect(tauri.relocateLibrary).toHaveBeenCalledWith(
        "/Volumes/Music/Spiral",
        "switch",
      ),
    );
  });

  it("imports music found there for a new library", async () => {
    tauri.getLibrary.mockResolvedValue([]);
    tauri.inspectLibraryDestination.mockResolvedValue(
      destination({ audioFileCount: 12 }),
    );
    await change();
    await waitFor(() =>
      expect(tauri.relocateLibrary).toHaveBeenCalledWith(
        "/Volumes/Music/Spiral",
        "freshImport",
      ),
    );
  });

  it("still confirms when a library with tracks already exists", async () => {
    tauri.getLibrary.mockResolvedValue([{ id: 1 }]);
    tauri.inspectLibraryDestination.mockResolvedValue(destination());
    await change();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(tauri.relocateLibrary).not.toHaveBeenCalled();
  });

  it("shows why a folder can't be used", async () => {
    tauri.inspectLibraryDestination.mockResolvedValue(
      destination({ blockedReason: "That folder is inside the library." }),
    );
    await change();
    expect(
      await screen.findByText("That folder is inside the library."),
    ).toBeInTheDocument();
    expect(tauri.relocateLibrary).not.toHaveBeenCalled();
  });
});

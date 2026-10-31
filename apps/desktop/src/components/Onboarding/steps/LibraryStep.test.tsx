import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLibrarySettingsStore } from "../../../store/useLibrarySettingsStore";
import { useSourcesStore } from "../../../store/useSourcesStore";
import type {
  LibraryDestinationInfo,
  LibrarySettings,
} from "../../../types/library";
import type { Source } from "../../../types/source";
import { LibraryStep } from "./LibraryStep";

const tauri = vi.hoisted(() => ({
  getLibrary: vi.fn(),
  pickLibraryFolder: vi.fn(),
  inspectLibraryDestination: vi.fn(),
  relocateLibrary: vi.fn(),
  pickMusicFolder: vi.fn(),
  addSource: vi.fn(),
  rescanSource: vi.fn(),
  setSourceOrganize: vi.fn(),
  previewOrganizeSource: vi.fn(),
  applyOrganizeSource: vi.fn(),
  listSources: vi.fn(),
  getSourceStatuses: vi.fn(),
  FILE_PLAN_PROGRESS_EVENT: "library://file-plan-progress",
}));

vi.mock("../../../lib/tauri", () => tauri);
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
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

const musicSource: Source = {
  id: 3,
  rootPath: "/Users/me/Music",
  name: "Music",
  autoOrganize: false,
  pathFormat: null,
  importTarget: false,
  createdAt: "2026-01-01T00:00:00Z",
};

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

  describe("I already have a music folder", () => {
    beforeEach(() => {
      useSourcesStore.setState({ sources: [], sourcesById: new Map() });
      tauri.pickMusicFolder.mockResolvedValue("/Users/me/Music");
      tauri.addSource.mockResolvedValue(musicSource);
      tauri.listSources.mockResolvedValue([
        { ...musicSource, autoOrganize: true },
      ]);
      tauri.getSourceStatuses.mockResolvedValue([]);
      tauri.rescanSource.mockResolvedValue({ sourceId: 3 });
      tauri.previewOrganizeSource.mockResolvedValue({
        moves: 4,
        renamed: 0,
        skipped: 0,
        unchanged: 0,
        sample: [],
        conflicts: [],
      });
      tauri.applyOrganizeSource.mockResolvedValue({
        moved: 4,
        failed: 0,
        errors: [],
      });
    });

    async function addMusicFolder() {
      render(<LibraryStep />);
      fireEvent.click(
        screen.getByRole("button", { name: "Use my music folder…" }),
      );
      return screen.findByRole("switch", {
        name: /Let Spiral organize this folder/,
      });
    }

    it("adds the picked folder as a source, unorganized", async () => {
      render(<LibraryStep />);
      fireEvent.click(
        screen.getByRole("button", { name: "Use my music folder…" }),
      );
      await waitFor(() =>
        expect(tauri.addSource).toHaveBeenCalledWith("/Users/me/Music"),
      );
      expect(
        await screen.findByText(
          "Spiral is adding the music in /Users/me/Music.",
        ),
      ).toBeInTheDocument();
      expect(tauri.relocateLibrary).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Add another folder…" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("switch", { name: /Let Spiral organize this folder/ }),
      ).not.toBeChecked();
      expect(tauri.setSourceOrganize).not.toHaveBeenCalled();
    });

    it("organizes it through the preview after a full scan", async () => {
      const organize = await addMusicFolder();
      fireEvent.click(organize);
      const dialog = await screen.findByRole("dialog", {
        name: "Organize “Music”?",
      });
      expect(tauri.rescanSource).toHaveBeenCalledWith(3);
      expect(tauri.previewOrganizeSource).toHaveBeenCalledWith(3, undefined);
      fireEvent.click(
        await within(dialog).findByRole("button", { name: "Move 4 files" }),
      );
      await waitFor(() =>
        expect(tauri.applyOrganizeSource).toHaveBeenCalledWith(3, undefined),
      );
      await waitFor(() =>
        expect(
          screen.getByRole("switch", {
            name: /Let Spiral organize this folder/,
          }),
        ).toBeChecked(),
      );
    });

    it("leaves it unorganized when the preview is cancelled", async () => {
      const organize = await addMusicFolder();
      fireEvent.click(organize);
      const dialog = await screen.findByRole("dialog", {
        name: "Organize “Music”?",
      });
      await within(dialog).findByRole("button", { name: "Move 4 files" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(tauri.applyOrganizeSource).not.toHaveBeenCalled();
      expect(tauri.setSourceOrganize).not.toHaveBeenCalled();
      expect(organize).not.toBeChecked();
    });

    it("does nothing when the picker is cancelled", async () => {
      tauri.pickMusicFolder.mockResolvedValue(null);
      render(<LibraryStep />);
      fireEvent.click(
        screen.getByRole("button", { name: "Use my music folder…" }),
      );
      await waitFor(() => expect(tauri.pickMusicFolder).toHaveBeenCalled());
      expect(tauri.addSource).not.toHaveBeenCalled();
    });

    it("explains why a folder can't be added", async () => {
      tauri.pickMusicFolder.mockResolvedValue(
        "/Users/me/Music/Spiral Library/Tracks",
      );
      tauri.addSource.mockRejectedValue(
        "source_inside_library: /Users/me/Music/Spiral Library/Tracks is inside the Spiral folder",
      );
      render(<LibraryStep />);
      fireEvent.click(
        screen.getByRole("button", { name: "Use my music folder…" }),
      );
      expect(
        await screen.findByText(
          "That folder is inside the Spiral folder. Its music is already in your library.",
        ),
      ).toBeInTheDocument();
    });
  });
});

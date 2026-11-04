import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useLibrarySettingsStore,
  type ImportChoice,
} from "../../store/useLibrarySettingsStore";
import { useSourcesStore } from "../../store/useSourcesStore";
import type { Source } from "../../types/source";
import { ImportChoiceModal } from "./ImportChoiceModal";

const tauri = vi.hoisted(() => ({
  setImportSource: vi.fn(),
  getImportSource: vi.fn(),
  addSource: vi.fn(),
  pickMusicFolder: vi.fn(),
  saveLibrarySettings: vi.fn(),
  getLibrarySettings: vi.fn(),
  listSources: vi.fn(),
  getSourceStatuses: vi.fn(),
}));

vi.mock("../../lib/tauri", () => tauri);
vi.mock("../../lib/scheduling", () => ({
  afterUiTransition: () => Promise.resolve(),
}));

const source = (patch: Partial<Source> & Pick<Source, "id" | "name">) =>
  ({
    rootPath: `/Music/${patch.name}`,
    autoOrganize: false,
    pathFormat: null,
    importTarget: false,
    createdAt: "2026-01-01T00:00:00Z",
    ...patch,
  }) as Source;

const tracks = source({ id: 1, name: "Tracks", autoOrganize: true });
const music = source({ id: 3, name: "Music", importTarget: true });
const archive = source({ id: 4, name: "Archive" });

function setSources(
  list: Source[],
  statuses: Record<number, "unreachable"> = {},
) {
  useSourcesStore.setState({
    sources: list,
    sourcesById: new Map(list.map((s) => [s.id, s])),
    statuses,
  });
  // The modal refreshes them when it opens.
  tauri.getSourceStatuses.mockResolvedValue(
    Object.entries(statuses).map(([sourceId, status]) => ({
      sourceId: Number(sourceId),
      status,
    })),
  );
}

const picker = () => screen.findByRole("button", { name: "Copy into" });

async function pick(name: string) {
  fireEvent.click(await picker());
  fireEvent.click(screen.getByRole("menuitemradio", { name }));
}

/** Asks where to copy the way an import does, resolving with the answer. */
function destination(): Promise<ImportChoice> {
  return useLibrarySettingsStore.getState().resolveImportDestination();
}

describe("ImportChoiceModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauri.listSources.mockResolvedValue([]);
    tauri.getSourceStatuses.mockResolvedValue([]);
    useLibrarySettingsStore.setState({ importPrompt: null });
  });

  it("copies into a reachable import target without asking", async () => {
    tauri.getImportSource.mockResolvedValue({
      source: music,
      copyAvailable: true,
    });
    setSources([tracks, music]);
    render(<ImportChoiceModal />);
    await expect(destination()).resolves.toEqual({});
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  describe("when the import target can't take the copy", () => {
    beforeEach(() => {
      tauri.getImportSource.mockResolvedValue({
        source: music,
        copyAvailable: false,
      });
    });

    it("picks another folder for this import only", async () => {
      setSources([tracks, music, archive], { 3: "unreachable" });
      render(<ImportChoiceModal />);
      const choice = destination();
      expect(await picker()).toHaveTextContent("Tracks");
      expect(
        screen.getByRole("heading", {
          name: "Default music folder disconnected",
        }),
      ).toBeTruthy();
      expect(screen.getByText(/choose a new source/)).toBeTruthy();

      fireEvent.click(await picker());
      const options = screen.getAllByRole("menuitemradio");
      expect(
        options.map((option) => [
          option.textContent,
          (option as HTMLButtonElement).disabled,
        ]),
      ).toEqual([
        ["Tracks", false],
        ["Music (offline)", true],
        ["Archive", false],
      ]);

      fireEvent.click(screen.getByRole("menuitemradio", { name: "Archive" }));
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
      await expect(choice).resolves.toEqual({ sourceId: 4 });
      expect(tauri.setImportSource).not.toHaveBeenCalled();
    });

    it("cancels the import", async () => {
      setSources([tracks, music], { 3: "unreachable" });
      render(<ImportChoiceModal />);
      const choice = destination();
      fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
      await expect(choice).rejects.toThrow("Import cancelled");
    });

    it("with every folder offline, disables the picker until one is added", async () => {
      setSources([music], { 3: "unreachable" });
      render(<ImportChoiceModal />);
      void destination();
      expect(await screen.findByText(/add a new source/)).toBeTruthy();
      expect(await picker()).toBeDisabled();
      expect(await picker()).toHaveTextContent("Music (offline)");
      expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
    });

    it("shows a folder that went offline since statuses last loaded", async () => {
      const other = source({ id: 5, name: "Rips" });
      tauri.getImportSource.mockResolvedValue({
        source: music,
        copyAvailable: false,
      });
      const reachable = source({ id: 6, name: "Live" });
      setSources([music, other, reachable]);
      tauri.getSourceStatuses.mockResolvedValue([
        { sourceId: 3, status: "unreachable" },
        { sourceId: 5, status: "unreachable" },
        { sourceId: 6, status: "watching" },
      ]);
      render(<ImportChoiceModal />);
      void destination().catch(() => {});

      await waitFor(async () =>
        expect(await picker()).toHaveTextContent("Live"),
      );
      fireEvent.click(await picker());
      expect(
        screen.getByRole("menuitemradio", { name: /Rips/ }),
      ).toBeDisabled();
    });

    it("with every folder offline, copies into a folder added there", async () => {
      const added = source({ id: 5, name: "Rips" });
      tauri.pickMusicFolder.mockResolvedValue("/Music/Rips");
      tauri.addSource.mockResolvedValue(added);
      tauri.listSources.mockResolvedValue([music, added]);
      tauri.getSourceStatuses.mockResolvedValue([
        { sourceId: 3, status: "unreachable" },
      ]);
      setSources([music], { 3: "unreachable" });
      render(<ImportChoiceModal />);
      const choice = destination();

      fireEvent.click(
        await screen.findByRole("button", { name: /Add a folder/ }),
      );
      await waitFor(() =>
        expect(tauri.addSource).toHaveBeenCalledWith("/Music/Rips"),
      );
      // The import target stays where it is; it's only offline.
      expect(tauri.setImportSource).not.toHaveBeenCalled();
      await waitFor(async () => {
        expect(await picker()).toHaveTextContent("Rips");
        expect(await picker()).toBeEnabled();
      });
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
      await expect(choice).resolves.toEqual({ sourceId: 5 });
    });
  });

  describe("with no import target", () => {
    beforeEach(() => {
      tauri.getImportSource.mockResolvedValue({
        source: null,
        copyAvailable: false,
      });
    });

    it("makes the folder picked the import target", async () => {
      tauri.setImportSource.mockResolvedValue({
        ...archive,
        importTarget: true,
      });
      setSources([tracks, archive]);
      render(<ImportChoiceModal />);
      const choice = destination();
      await pick("Archive");
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
      await expect(choice).resolves.toEqual({ sourceId: 4 });
      expect(tauri.setImportSource).toHaveBeenCalledWith(4);
    });
  });
});

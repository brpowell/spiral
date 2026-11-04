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
      const picker = (await screen.findByLabelText(
        "Copy into",
      )) as HTMLSelectElement;
      expect(picker).toHaveValue("1");
      expect(
        Array.from(picker.options, (option) => [
          option.textContent,
          option.disabled,
        ]),
      ).toEqual([
        ["Tracks", false],
        ["Music (offline)", true],
        ["Archive", false],
      ]);
      expect(screen.getByText(/default folder isn't connected/)).toBeTruthy();

      fireEvent.change(picker, { target: { value: "4" } });
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

    it("with every folder offline, offers only adding one", async () => {
      setSources([music], { 3: "unreachable" });
      render(<ImportChoiceModal />);
      void destination();
      expect(
        await screen.findByText(/music folders aren't connected/),
      ).toBeTruthy();
      expect(screen.queryByLabelText("Copy into")).toBeNull();
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

      await waitFor(() =>
        expect(screen.getByRole("option", { name: /Rips/ })).toBeDisabled(),
      );
      expect(screen.getByLabelText("Copy into")).toHaveValue("6");
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
      const picker = await screen.findByLabelText("Copy into");
      expect(tauri.addSource).toHaveBeenCalledWith("/Music/Rips");
      // The import target stays where it is; it's only offline.
      expect(tauri.setImportSource).not.toHaveBeenCalled();
      expect(picker).toHaveValue("5");
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
      const picker = await screen.findByLabelText("Copy into");
      expect(screen.getByText(/becomes your default folder/)).toBeTruthy();
      fireEvent.change(picker, { target: { value: "4" } });
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
      await expect(choice).resolves.toEqual({ sourceId: 4 });
      expect(tauri.setImportSource).toHaveBeenCalledWith(4);
    });
  });
});

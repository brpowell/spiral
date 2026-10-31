import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useLibrarySettingsStore,
  type ImportChoice,
} from "../../store/useLibrarySettingsStore";
import { useSourcesStore } from "../../store/useSourcesStore";
import type { LibrarySettings } from "../../types/library";
import type { Source } from "../../types/source";
import { ImportChoiceModal } from "./ImportChoiceModal";

const tauri = vi.hoisted(() => ({
  setImportSource: vi.fn(),
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

const tracks = source({ id: 1, name: "Spiral", autoOrganize: true });
const other = source({ id: 2, name: "External", rootPath: null });
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
}

/** Opens the prompt the way an import does, and resolves with the user's choice. */
function prompt(): Promise<ImportChoice> {
  return useLibrarySettingsStore.getState().resolveImportMode();
}

describe("ImportChoiceModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauri.saveLibrarySettings.mockImplementation((patch) =>
      Promise.resolve({ importMode: "ask", ...patch }),
    );
    tauri.listSources.mockResolvedValue([]);
    tauri.getSourceStatuses.mockResolvedValue([]);
    useLibrarySettingsStore.setState({
      settings: { importMode: "ask" } as LibrarySettings,
      importPrompt: null,
    });
  });

  it("copies into the import target with no picker when it's the only folder", async () => {
    setSources([{ ...tracks, importTarget: true }, other]);
    render(<ImportChoiceModal />);
    const choice = prompt();
    fireEvent.click(
      await screen.findByRole("button", { name: /Add to Spiral/ }),
    );
    await expect(choice).resolves.toEqual({
      mode: "copy",
      sourceId: undefined,
    });
    expect(screen.queryByLabelText("Copy into")).toBeNull();
  });

  it("offers a destination picker, starting at the import target", async () => {
    setSources([tracks, other, music, archive]);
    render(<ImportChoiceModal />);
    const choice = prompt();
    const picker = await screen.findByLabelText("Copy into");
    expect(picker).toHaveValue("3");
    const names = Array.from(
      (picker as HTMLSelectElement).options,
      (option) => option.textContent,
    );
    expect(names).toEqual(["Tracks", "Music", "Archive"]);

    fireEvent.change(picker, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /Add to Spiral/ }));
    await expect(choice).resolves.toEqual({ mode: "copy", sourceId: 4 });
    expect(tauri.setImportSource).not.toHaveBeenCalled();
  });

  it("keeps files where they are in Other, whatever the picker says", async () => {
    setSources([tracks, other, music]);
    render(<ImportChoiceModal />);
    const choice = prompt();
    fireEvent.change(await screen.findByLabelText("Copy into"), {
      target: { value: "1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Keep files where they are/ }),
    );
    await expect(choice).resolves.toEqual({
      mode: "reference",
      sourceId: undefined,
    });
  });

  it("disables an offline destination", async () => {
    setSources([tracks, other, music, archive], { 4: "unreachable" });
    render(<ImportChoiceModal />);
    void prompt();
    const picker = (await screen.findByLabelText(
      "Copy into",
    )) as HTMLSelectElement;
    const archiveOption = Array.from(picker.options).find(
      (option) => option.value === "4",
    )!;
    expect(archiveOption.textContent).toBe("Archive (offline)");
    expect(archiveOption.disabled).toBe(true);
  });

  it("remembering a copy into another source makes it the import target", async () => {
    tauri.setImportSource.mockResolvedValue({ ...archive, importTarget: true });
    setSources([tracks, other, music, archive]);
    render(<ImportChoiceModal />);
    const choice = prompt();
    fireEvent.change(await screen.findByLabelText("Copy into"), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Don't ask again" }));
    fireEvent.click(screen.getByRole("button", { name: /Add to Spiral/ }));
    await expect(choice).resolves.toEqual({ mode: "copy", sourceId: 4 });
    expect(tauri.saveLibrarySettings).toHaveBeenCalledWith({
      importMode: "copy",
    });
    await waitFor(() => expect(tauri.setImportSource).toHaveBeenCalledWith(4));
  });

  it("skips the prompt when Preferences says always copy", async () => {
    useLibrarySettingsStore.setState({
      settings: { importMode: "copy" } as LibrarySettings,
    });
    await expect(prompt()).resolves.toEqual({ mode: "copy" });
  });
});

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOnboardingStore } from "@/store/useOnboardingStore";
import { useSourcesStore } from "@/store/useSourcesStore";
import type { Source } from "@/types/source";
import { FoldersStep } from "./FoldersStep";

const tauri = vi.hoisted(() => ({
  pickMusicFolder: vi.fn(),
  addSource: vi.fn(),
  removeSource: vi.fn(),
  listSources: vi.fn(),
  setImportSource: vi.fn(),
  setSourceOrganize: vi.fn(),
  setSourcePathFormat: vi.fn(),
}));
const player = vi.hoisted(() => ({
  loadLibrary: vi.fn(),
  library: [] as { sourceId: number; missingSince: string | null }[],
}));

vi.mock("@/lib/tauri", () => tauri);
vi.mock("@/store/usePlayerStore", () => ({
  usePlayerStore: Object.assign(
    (select: (s: typeof player) => unknown) => select(player),
    { getState: () => player },
  ),
}));
vi.mock("@tauri-apps/api/path", () => ({
  homeDir: vi.fn().mockResolvedValue("/Users/me"),
}));

function source(patch: Partial<Source>): Source {
  return {
    id: 3,
    rootPath: "/Users/me/Music",
    name: "Music",
    autoOrganize: false,
    pathFormat: null,
    importTarget: false,
    createdAt: "2026-01-01T00:00:00Z",
    ...patch,
  };
}

/** Clicks the step's Add folder, and returns the Add dialog it opens. */
async function addFolder(): Promise<HTMLElement> {
  fireEvent.click(pageAddButton());
  return screen.findByRole("dialog", { name: "Add music source" });
}

/** The step's own Add folder, not the one finishing the Add dialog. */
function pageAddButton(): HTMLElement {
  return screen
    .getAllByRole("button", { name: "Add folder" })
    .find((button) => !button.closest("[role=dialog]")) as HTMLElement;
}

/** Finishes adding with the Add dialog as it is. */
async function confirmAdd(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole("button", { name: "Add folder" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

/** Opens a folder's more menu and picks an item from it. */
function chooseFromMenu(name: string, label: RegExp) {
  fireEvent.click(screen.getByRole("button", { name: `Actions for ${name}` }));
  fireEvent.click(screen.getByRole("menuitem", { name: label }));
}

describe("FoldersStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    player.library = [];
    tauri.setImportSource.mockResolvedValue(undefined);
    useOnboardingStore.setState({
      addedSourceIds: [],
      placeholderSourceId: null,
    });
    useSourcesStore.setState({
      sources: [],
      sourcesById: new Map(),
    });
    tauri.pickMusicFolder.mockResolvedValue("/Users/me/Music");
    tauri.addSource.mockResolvedValue(source({}));
    // Sources as the backend has them: what the store holds, less removals.
    const removed = new Set<number>();
    tauri.removeSource.mockImplementation((id: number) => {
      removed.add(id);
      return Promise.resolve(0);
    });
    tauri.listSources.mockImplementation(() =>
      Promise.resolve(
        useSourcesStore.getState().sources.filter((s) => !removed.has(s.id)),
      ),
    );
    tauri.setSourceOrganize.mockImplementation((id: number, on: boolean) =>
      Promise.resolve(source({ id, autoOrganize: on })),
    );
  });

  it("doesn't list a new library's placeholder Tracks", () => {
    const tracks = source({
      id: 1,
      name: "Tracks",
      rootPath: "/Users/me/Music/Spiral/Tracks",
      importTarget: true,
    });
    useSourcesStore.setState({
      sources: [tracks],
      sourcesById: new Map([[1, tracks]]),
    });
    useOnboardingStore.setState({ placeholderSourceId: 1 });
    render(<FoldersStep />);
    expect(
      screen.queryByRole("list", { name: "Your music folders" }),
    ).toBeNull();
  });

  it("writes the home folder as ~ in folder paths", async () => {
    tauri.addSource.mockResolvedValue(source({}));
    render(<FoldersStep />);
    await addFolder();
    const list = await screen.findByRole("list", {
      name: "Your music folders",
    });
    expect(within(list).getByText("~/Music")).toBeInTheDocument();
  });

  it("shows each folder's counts under its path, as in Preferences", async () => {
    const music = source({});
    useSourcesStore.setState({
      sources: [music],
      sourcesById: new Map([[music.id, music]]),
    });
    player.library = [
      { sourceId: 3, missingSince: null },
      { sourceId: 3, missingSince: null },
    ];
    render(<FoldersStep />);
    const card = (await screen.findByText("~/Music")).closest(
      "li",
    ) as HTMLElement;
    expect(within(card).getByText("2 tracks")).toBeInTheDocument();
  });

  it("starts with just the Add folder button", () => {
    render(<FoldersStep />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("button", { name: "Add folder" })).toBeEnabled();
  });

  it("adds each picked folder to the list above the button", async () => {
    render(<FoldersStep />);
    await confirmAdd(await addFolder());
    expect(tauri.addSource).toHaveBeenCalledWith("/Users/me/Music");
    const list = screen.getByRole("list", { name: "Your music folders" });
    expect(await within(list).findByText("~/Music")).toBeInTheDocument();

    tauri.pickMusicFolder.mockResolvedValue("/Volumes/Archive");
    tauri.addSource.mockResolvedValue(
      source({ id: 4, name: "Archive", rootPath: "/Volumes/Archive" }),
    );
    await confirmAdd(await addFolder());
    expect(
      await within(list).findByText("/Volumes/Archive"),
    ).toBeInTheDocument();

    const items = list.querySelectorAll("li");
    // The path heads each card: no folder name above it.
    expect(
      [...items].map((li) => li.querySelector("code")?.textContent),
    ).toEqual(["~/Music", "/Volumes/Archive"]);
    expect(within(list).queryByText("Music")).toBeNull();
    // Built-in sources aren't the user's folders.
    expect(screen.queryByText("Tracks")).toBeNull();
  });

  it("finishes adding with the defaults, organizing off", async () => {
    render(<FoldersStep />);
    const dialog = await addFolder();
    const organize = within(dialog).getByRole("checkbox", {
      name: /Automatically organize files/,
    });
    expect(organize).not.toBeChecked();
    // Nothing changed, yet the folder can still be added as it is.
    expect(
      within(dialog).getByRole("button", { name: "Add folder" }),
    ).toBeEnabled();
    await confirmAdd(dialog);
    expect(tauri.removeSource).not.toHaveBeenCalled();
    expect(tauri.setSourceOrganize).not.toHaveBeenCalled();
  });

  it("records organizing when it's turned on while adding", async () => {
    render(<FoldersStep />);
    const dialog = await addFolder();
    fireEvent.click(
      within(dialog).getByRole("checkbox", {
        name: /Automatically organize files/,
      }),
    );
    await confirmAdd(dialog);
    // Only the setting is recorded now: the switch turns on, nothing moves.
    expect(tauri.setSourceOrganize).toHaveBeenCalledWith(3, true);
  });

  it("takes the folder back out when adding is cancelled", async () => {
    render(<FoldersStep />);
    const dialog = await addFolder();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(tauri.removeSource).toHaveBeenCalledWith(3));
    await waitFor(() => expect(screen.queryByRole("list")).toBeNull());
    expect(useOnboardingStore.getState().addedSourceIds).toEqual([]);
  });

  it("reopens a folder's settings from its menu", async () => {
    render(<FoldersStep />);
    await confirmAdd(await addFolder());
    chooseFromMenu("Music", /^Edit/);
    const dialog = await screen.findByRole("dialog", {
      name: "Edit music source",
    });
    // Editing again: Save waits for a change, and Cancel keeps the folder.
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(tauri.removeSource).not.toHaveBeenCalled();
  });

  it("does nothing when the picker is cancelled", async () => {
    tauri.pickMusicFolder.mockResolvedValue(null);
    render(<FoldersStep />);
    fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
    await waitFor(() => expect(tauri.pickMusicFolder).toHaveBeenCalled());
    expect(tauri.addSource).not.toHaveBeenCalled();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("explains why a folder can't be added", async () => {
    tauri.addSource.mockRejectedValue(
      "source_spiral_data: /Users/me/Spiral/Artwork is the Spiral folder or holds its data",
    );
    render(<FoldersStep />);
    fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That folder is the Spiral folder or holds its database, artwork or packs.",
    );
  });

  it("removes a folder it added, leaving the files", async () => {
    render(<FoldersStep />);
    await confirmAdd(await addFolder());
    chooseFromMenu("Music", /^Remove/);
    await waitFor(() => expect(tauri.removeSource).toHaveBeenCalledWith(3));
    await waitFor(() => expect(screen.queryByRole("list")).toBeNull());
    expect(player.loadLibrary).toHaveBeenCalledWith({
      preservePlayback: true,
    });
    expect(useOnboardingStore.getState().addedSourceIds).toEqual([]);
  });

  it("leaves folders that were already sources to Preferences", () => {
    const existing = source({ id: 5, name: "Old", rootPath: "/Old" });
    useSourcesStore.setState({
      sources: [existing],
      sourcesById: new Map([[existing.id, existing]]),
    });
    render(<FoldersStep />);
    expect(screen.getByText("/Old")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Old" }));
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Edit…", "Make default"]);
  });

  it("makes a folder the default from its menu", async () => {
    render(<FoldersStep />);
    await confirmAdd(await addFolder());
    chooseFromMenu("Music", /Make default/);
    await waitFor(() => expect(tauri.setImportSource).toHaveBeenCalledWith(3));
  });

  it("explains why a folder can't be removed", async () => {
    tauri.removeSource.mockRejectedValue("source_not_found: 3");
    render(<FoldersStep />);
    await confirmAdd(await addFolder());
    chooseFromMenu("Music", /^Remove/);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("list", { name: "Your music folders" }),
      ).getByText("~/Music"),
    ).toBeInTheDocument();
  });
});

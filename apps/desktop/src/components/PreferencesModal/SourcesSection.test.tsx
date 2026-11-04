import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLibrarySettingsStore } from "../../store/useLibrarySettingsStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useBackgroundTasksStore } from "../../store/useBackgroundTasksStore";
import { useSourcesStore } from "../../store/useSourcesStore";
import type { LibrarySettings } from "../../types/library";
import type { FilePlanSummary, Source } from "../../types/source";
import type { Track } from "../../types/track";
import { revealInFileManagerLabel } from "../../lib/fileManager";
import { SourcesSection } from "./SourcesSection";

const tauri = vi.hoisted(() => ({
  listSources: vi.fn(),
  getSourceStatuses: vi.fn(),
  addSource: vi.fn(),
  pickMusicFolder: vi.fn(),
  relocateSource: vi.fn(),
  removeSource: vi.fn(),
  rescanSource: vi.fn(),
  revealPathInFileManager: vi.fn(),
  setImportSource: vi.fn(),
  setSourceOrganize: vi.fn(),
  setSourcePathFormat: vi.fn(),
  previewOrganizeSource: vi.fn(),
  applyOrganizeSource: vi.fn(),
  FILE_PLAN_PROGRESS_EVENT: "library://file-plan-progress",
}));

vi.mock("../../lib/tauri", () => tauri);
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@tauri-apps/api/path", () => ({
  homeDir: vi.fn().mockResolvedValue("/Users/me"),
}));

const sources: Source[] = [
  {
    id: 1,
    rootPath: "/Users/me/Music/Spiral Library/Tracks",
    name: "Tracks",
    autoOrganize: true,
    pathFormat: null,
    importTarget: true,
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: 3,
    rootPath: "/Volumes/Big/Music",
    name: "Music",
    autoOrganize: false,
    pathFormat: null,
    importTarget: false,
    createdAt: "2026-01-01T00:00:00Z",
  },
];

const track = (id: number, sourceId: number, missingSince?: string) =>
  ({
    id,
    title: `T${id}`,
    filePath: `/x/T${id}.mp3`,
    sourceId,
    missingSince,
  }) as Track;

/** A row, found by its menu: folder cards show their path, not their name. */
function item(name: string): HTMLElement {
  return screen
    .getByRole("button", { name: `Actions for ${name}` })
    .closest("li") as HTMLElement;
}

/** Opens a row's more menu and picks an item from it. */
function chooseFromMenu(name: string, label: RegExp) {
  fireEvent.click(screen.getByRole("button", { name: `Actions for ${name}` }));
  fireEvent.click(screen.getByRole("menuitem", { name: label }));
}

/** Opens a folder's edit dialog. */
async function openEdit(name: string): Promise<HTMLElement> {
  chooseFromMenu(name, /^Edit/);
  return screen.findByRole("dialog", { name: "Edit music source" });
}

/** The labels in a row's more menu, which is closed again afterwards. */
async function menuItems(name: string): Promise<string[]> {
  const trigger = screen.getByRole("button", { name: `Actions for ${name}` });
  fireEvent.click(trigger);
  const items = screen
    .getAllByRole("menuitem")
    .map((el) => el.textContent ?? "");
  fireEvent.click(trigger);
  await waitFor(() =>
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0),
  );
  return items;
}

const plan: FilePlanSummary = {
  moves: 2,
  renamed: 0,
  skipped: 0,
  unchanged: 0,
  sample: [],
  conflicts: [],
};

describe("SourcesSection", () => {
  const loadLibrary = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    tauri.listSources.mockResolvedValue(sources);
    tauri.getSourceStatuses.mockResolvedValue([
      { sourceId: 3, status: "unreachable" },
    ]);
    tauri.previewOrganizeSource.mockResolvedValue(plan);
    useBackgroundTasksStore.setState({ tasks: [] });
    tauri.applyOrganizeSource.mockResolvedValue({
      moved: 2,
      failed: 0,
      errors: [],
    });
    useSourcesStore.setState({
      sources: [],
      sourcesById: new Map(),
      statuses: {},
    });
    useLibrarySettingsStore.setState({
      settings: {
        defaultOrganizePathFormat: "{albumArtist}/{album}/{title}.{ext}",
      } as LibrarySettings,
    });
    usePlayerStore.setState({
      library: [track(1, 1), track(2, 3), track(3, 3, "2026-10-01T12:00:00Z")],
      loadLibrary,
    });
  });

  async function renderSection() {
    render(<SourcesSection />);
    await screen.findByRole("button", { name: "Actions for Music" });
  }

  it("lists every source with its path and counts", async () => {
    await renderSection();
    // A labelled group inside Preferences → Library, not a section of its own.
    expect(screen.getByRole("group", { name: "Music folders" })).toBeTruthy();
    // Just the label: the folder cards speak for themselves.
    expect(screen.queryByText(/plays music from these folders/)).toBeNull();

    const tracks = item("Tracks");
    expect(
      // Home is written as ~; paths outside it stay in full.
      await within(tracks).findByText("~/Music/Spiral Library/Tracks"),
    ).toBeTruthy();
    expect(within(tracks).getByText(/^1 track/)).toBeTruthy();

    const music = item("Music");
    expect(within(music).getByText("/Volumes/Big/Music")).toBeTruthy();
    expect(within(music).getByText(/^2 tracks/)).toBeTruthy();
    expect(within(music).getByText("1 missing")).toBeTruthy();
  });

  it("flags an unreachable folder as offline", async () => {
    await renderSection();
    await waitFor(() =>
      expect(within(item("Music")).getByText("Offline")).toBeTruthy(),
    );
    expect(within(item("Tracks")).queryByText("Offline")).toBeNull();
  });

  it("won't remove the only folder, and says why", async () => {
    tauri.listSources.mockResolvedValue([sources[0]]);
    render(<SourcesSection />);
    const trigger = await screen.findByRole("button", {
      name: "Actions for Tracks",
    });
    fireEvent.click(trigger);
    const remove = screen.getByRole("menuitem", { name: /Remove/ });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute(
      "title",
      "Spiral needs at least one music folder.",
    );
  });

  it("keeps a folder card to its path and counts", async () => {
    await renderSection();
    const tracks = item("Tracks");
    // No name row: the path heads the card, with the default noted inline.
    expect(within(tracks).queryByText("Tracks")).toBeNull();
    const meta = within(tracks).getByText(/^1 track/);
    expect(meta.textContent).toBe("1 track·Default");
    expect(within(meta).getByText("Default").querySelector("svg")).toBeTruthy();
    expect(within(tracks).queryByRole("checkbox")).toBeNull();
    expect(within(tracks).queryByLabelText("Path format")).toBeNull();
    expect(within(tracks).getAllByRole("button")).toHaveLength(1);
    expect(within(item("Music")).queryByText("Default")).toBeNull();
  });

  it("offers Edit, Rescan, Show in Finder and Remove for every folder, and Make default for the rest", async () => {
    await renderSection();
    const reveal = revealInFileManagerLabel();
    // Make default only for folders that aren't it already.
    expect(await menuItems("Tracks")).toEqual([
      "Edit…",
      "Rescan",
      reveal,
      "Remove…",
    ]);
    expect(await menuItems("Music")).toEqual([
      "Edit…",
      "Make default",
      "Rescan",
      reveal,
      "Remove…",
    ]);
  });

  it("shows a folder in the file manager", async () => {
    tauri.revealPathInFileManager.mockResolvedValue(undefined);
    await renderSection();
    chooseFromMenu("Tracks", new RegExp(revealInFileManagerLabel()));
    expect(tauri.revealPathInFileManager).toHaveBeenCalledWith(
      "/Users/me/Music/Spiral Library/Tracks",
    );
  });

  it("can't show an offline folder in the file manager", async () => {
    await renderSection();
    await waitFor(() =>
      expect(within(item("Music")).getByText("Offline")).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Actions for Music" }));
    expect(
      screen.getByRole("menuitem", { name: revealInFileManagerLabel() }),
    ).toBeDisabled();
  });

  it("rescans from the menu", async () => {
    tauri.rescanSource.mockResolvedValue({
      added: 1,
      updated: 0,
      moved: 2,
      missing: 0,
      restored: 0,
    });
    await renderSection();
    chooseFromMenu("Music", /Rescan/);
    await waitFor(() => expect(tauri.rescanSource).toHaveBeenCalledWith(3));
    expect(
      await screen.findByText(/Scan finished: 1 added, 0 updated, 2 moved/),
    ).toBeTruthy();
  });

  it("has no writable switch or read-only badge", async () => {
    await renderSection();
    expect(screen.queryByText(/Read-only/)).toBeNull();
    expect(screen.queryByText(/edit tags in this folder/)).toBeNull();
  });

  it("shows a folder's settings in the edit dialog", async () => {
    await renderSection();
    const dialog = await openEdit("Tracks");
    expect(
      within(dialog).getByText("~/Music/Spiral Library/Tracks"),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("checkbox", {
        name: "Automatically organize files",
      }),
    ).toBeChecked();
    // The default is chosen from the card's menu, not here.
    expect(within(dialog).queryByText(/default folder/i)).toBeNull();
    expect(within(dialog).getAllByRole("checkbox")).toHaveLength(1);
    // Blank uses the default, which shows as the placeholder.
    expect(within(dialog).getByLabelText("Path format")).toHaveAttribute(
      "placeholder",
      "{albumArtist}/{album}/{title}.{ext}",
    );
  });

  it("previews the format with one of the folder's tracks", async () => {
    usePlayerStore.setState({
      library: [
        {
          ...track(1, 1),
          title: "Blue",
          artist: "Joni",
          albumArtist: "Joni",
          album: "Blue",
          filePath: "/x/blue.flac",
        } as Track,
      ],
    });
    await renderSection();
    const dialog = await openEdit("Tracks");
    const example = within(dialog).getByText("Joni/Blue/Blue.flac");
    expect(example.parentElement?.textContent).toBe("e.g. Joni/Blue/Blue.flac");
    fireEvent.change(within(dialog).getByLabelText("Path format"), {
      target: { value: "{artist} - {title}.{ext}" },
    });
    expect(within(dialog).getByText("Joni - Blue.flac")).toBeTruthy();
  });

  it("lists tokens in a disclosure and inserts one at the cursor", async () => {
    await renderSection();
    // Tracks is organized, so its format is in use and editable.
    const dialog = await openEdit("Tracks");
    expect(within(dialog).queryByText("Track title")).toBeNull();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Show path tokens" }),
    );
    expect(within(dialog).getByText("Track title")).toBeTruthy();
    // Open, the trigger says what clicking it again does.
    expect(
      within(dialog).getByRole("button", { name: "Hide path tokens" }),
    ).toBeTruthy();

    const input = within(dialog).getByLabelText(
      "Path format",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "{artist}/.{ext}" } });
    input.setSelectionRange(9, 9);
    fireEvent.click(within(dialog).getByRole("button", { name: "{title}" }));
    expect(input).toHaveValue("{artist}/{title}.{ext}");
  });

  it("enables Save only once something has changed", async () => {
    await renderSection();
    const dialog = await openEdit("Music");
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    const organize = within(dialog).getByRole("checkbox", {
      name: "Automatically organize files",
    });
    fireEvent.click(organize);
    expect(save).toBeEnabled();
    fireEvent.click(organize);
    expect(save).toBeDisabled();

    // Whitespace means the default format, same as blank.
    const input = within(dialog).getByLabelText("Path format");
    fireEvent.change(input, { target: { value: "  " } });
    expect(save).toBeDisabled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(
      screen.getByRole("dialog", { name: "Edit music source" }),
    ).toBeTruthy();
    fireEvent.change(input, { target: { value: "{title}.{ext}" } });
    expect(save).toBeEnabled();
  });

  it("changes nothing until Save, and nothing on Cancel", async () => {
    await renderSection();
    const dialog = await openEdit("Music");
    fireEvent.click(
      within(dialog).getByRole("checkbox", {
        name: "Automatically organize files",
      }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Discard",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(tauri.setSourceOrganize).not.toHaveBeenCalled();
    expect(tauri.applyOrganizeSource).not.toHaveBeenCalled();
  });

  it("makes a folder the default from its menu", async () => {
    tauri.getSourceStatuses.mockResolvedValue([]);
    tauri.setImportSource.mockResolvedValue({
      ...sources[1],
      importTarget: true,
    });
    await renderSection();
    chooseFromMenu("Music", /Make default/);
    await waitFor(() => expect(tauri.setImportSource).toHaveBeenCalledWith(3));
    await waitFor(() => expect(tauri.listSources).toHaveBeenCalledTimes(2));
  });

  it("won't make an offline folder the default", async () => {
    await renderSection();
    await waitFor(() =>
      expect(within(item("Music")).getByText("Offline")).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Actions for Music" }));
    expect(
      screen.getByRole("menuitem", { name: /Make default/ }),
    ).toBeDisabled();
  });

  it("asks before discarding unsaved changes", async () => {
    await renderSection();
    const dialog = await openEdit("Music");
    fireEvent.click(
      within(dialog).getByRole("checkbox", {
        name: "Automatically organize files",
      }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    const prompt = await screen.findByRole("alertdialog", {
      name: "Discard changes?",
    });
    expect(prompt.textContent).toMatch(/Unsaved changes to this music source/);

    fireEvent.click(
      within(prompt).getByRole("button", { name: "Keep editing" }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(
      within(dialog).getByRole("checkbox", {
        name: "Automatically organize files",
      }),
    ).toBeChecked();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(
      within(
        await screen.findByRole("alertdialog", { name: "Discard changes?" }),
      ).getByRole("button", { name: "Discard" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(tauri.setSourceOrganize).not.toHaveBeenCalled();
  });

  it("closes without asking when nothing changed", async () => {
    await renderSection();
    const dialog = await openEdit("Music");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("changes a folder's location on Save", async () => {
    tauri.pickMusicFolder.mockResolvedValue("/Volumes/New/Music");
    tauri.relocateSource.mockResolvedValue({
      ...sources[1],
      rootPath: "/Volumes/New/Music",
    });
    await renderSection();
    const dialog = await openEdit("Music");
    fireEvent.click(
      within(dialog).getByRole("button", { name: /Change location/ }),
    );
    expect(await within(dialog).findByText("/Volumes/New/Music")).toBeTruthy();
    expect(tauri.relocateSource).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(tauri.relocateSource).toHaveBeenCalledWith(
        3,
        "/Volumes/New/Music",
      ),
    );
  });

  it("keeps the dialog open with a readable error when saving fails", async () => {
    tauri.pickMusicFolder.mockResolvedValue("/Volumes/Big/Music/Rock");
    tauri.relocateSource.mockRejectedValue(
      "source_overlap: /Volumes/Big/Music/Rock overlaps /Volumes/Big/Music",
    );
    await renderSection();
    const dialog = await openEdit("Music");
    fireEvent.click(
      within(dialog).getByRole("button", { name: /Change location/ }),
    );
    await within(dialog).findByText("/Volumes/Big/Music/Rock");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toMatch(/overlaps one of your sources/);
    expect(
      screen.getByRole("dialog", { name: "Edit music source" }),
    ).toBeTruthy();
  });

  /** Saves the open edit dialog and waits for it to close. */
  async function save(edit: HTMLElement) {
    fireEvent.click(within(edit).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  }

  const toastLabels = () =>
    useBackgroundTasksStore.getState().tasks.map((task) => task.label);

  it("organizes in the background on Save, without asking first", async () => {
    tauri.setSourceOrganize.mockResolvedValue({
      ...sources[1],
      autoOrganize: true,
    });
    await renderSection();
    const edit = await openEdit("Music");
    fireEvent.click(
      within(edit).getByRole("checkbox", {
        name: "Automatically organize files",
      }),
    );
    await save(edit);
    expect(tauri.setSourceOrganize).toHaveBeenCalledWith(3, true);
    // No confirmation: the moves run straight away, reported in a toast.
    await waitFor(() =>
      expect(tauri.applyOrganizeSource).toHaveBeenCalledWith(3, undefined),
    );
    await waitFor(() => expect(toastLabels()).toContain("2 files organized"));
    expect(tauri.rescanSource).not.toHaveBeenCalled();
  });

  it("refuses organizing while the folder is offline, leaving it off", async () => {
    tauri.setSourceOrganize.mockRejectedValue(
      "source_unavailable: the folder /Music/Collection is not available",
    );
    await renderSection();
    const edit = await openEdit("Music");
    const organize = within(edit).getByRole("checkbox", {
      name: "Automatically organize files",
    });
    fireEvent.click(organize);
    fireEvent.click(within(edit).getByRole("button", { name: "Save" }));

    expect(await within(edit).findByRole("alert")).toHaveTextContent(
      "That music folder isn't available. Connect its drive and try again.",
    );
    expect(organize).not.toBeChecked();
    expect(tauri.applyOrganizeSource).not.toHaveBeenCalled();
    expect(toastLabels()).toEqual([]);
  });

  it("saves a new format, then organizes by it", async () => {
    tauri.setSourceOrganize.mockResolvedValue({
      ...sources[1],
      autoOrganize: true,
    });
    tauri.setSourcePathFormat.mockResolvedValue({
      ...sources[1],
      autoOrganize: true,
      pathFormat: "{artist}/{title}.{ext}",
    });
    await renderSection();
    const edit = await openEdit("Music");
    fireEvent.click(
      within(edit).getByRole("checkbox", {
        name: "Automatically organize files",
      }),
    );
    fireEvent.change(within(edit).getByLabelText("Path format"), {
      target: { value: "{artist}/{title}.{ext}" },
    });
    await save(edit);
    expect(tauri.setSourcePathFormat).toHaveBeenCalledWith(
      3,
      "{artist}/{title}.{ext}",
    );
    // Organized by the format just saved, the source's own.
    await waitFor(() =>
      expect(tauri.applyOrganizeSource).toHaveBeenCalledWith(3, undefined),
    );
  });

  it("turns organize off without moving anything", async () => {
    tauri.setSourceOrganize.mockResolvedValue({
      ...sources[0],
      autoOrganize: false,
    });
    await renderSection();
    const edit = await openEdit("Tracks");
    fireEvent.click(
      within(edit).getByRole("checkbox", {
        name: "Automatically organize files",
      }),
    );
    await save(edit);
    expect(tauri.setSourceOrganize).toHaveBeenCalledWith(1, false);
    expect(tauri.previewOrganizeSource).not.toHaveBeenCalled();
    expect(tauri.applyOrganizeSource).not.toHaveBeenCalled();
  });

  it("reorganizes an organized folder when its format changes", async () => {
    tauri.setSourcePathFormat.mockResolvedValue({
      ...sources[0],
      pathFormat: "{artist}/{title}.{ext}",
    });
    await renderSection();
    const edit = await openEdit("Tracks");
    fireEvent.change(within(edit).getByLabelText("Path format"), {
      target: { value: "{artist}/{title}.{ext}" },
    });
    await save(edit);
    expect(tauri.setSourcePathFormat).toHaveBeenCalledWith(
      1,
      "{artist}/{title}.{ext}",
    );
    await waitFor(() =>
      expect(tauri.applyOrganizeSource).toHaveBeenCalledWith(1, undefined),
    );
  });

  it("goes back to the default format, then reorganizes by it", async () => {
    tauri.listSources.mockResolvedValue([
      { ...sources[0], pathFormat: "{title}.{ext}" },
      sources[1],
    ]);
    tauri.setSourcePathFormat.mockResolvedValue(sources[0]);
    await renderSection();
    const edit = await openEdit("Tracks");
    const input = within(edit).getByLabelText("Path format");
    expect(input).toHaveValue("{title}.{ext}");
    fireEvent.change(input, { target: { value: "  " } });
    await save(edit);
    expect(tauri.setSourcePathFormat).toHaveBeenCalledWith(1, null);
    await waitFor(() =>
      expect(tauri.applyOrganizeSource).toHaveBeenCalledWith(1, undefined),
    );
  });

  it("shows no toast when every file is already in place", async () => {
    tauri.previewOrganizeSource.mockResolvedValue({ ...plan, moves: 0 });
    tauri.applyOrganizeSource.mockResolvedValue({
      moved: 0,
      failed: 0,
      errors: [],
    });
    tauri.setSourceOrganize.mockResolvedValue({
      ...sources[1],
      autoOrganize: true,
    });
    await renderSection();
    const edit = await openEdit("Music");
    fireEvent.click(
      within(edit).getByRole("checkbox", {
        name: "Automatically organize files",
      }),
    );
    await save(edit);
    await waitFor(() => expect(tauri.applyOrganizeSource).toHaveBeenCalled());
    expect(toastLabels()).toEqual([]);
  });

  it("keeps the path format off until organizing is on", async () => {
    await renderSection();
    const edit = await openEdit("Music");
    const input = within(edit).getByLabelText("Path format");
    // Music isn't organized: its format is unused, so it's disabled.
    expect(input).toBeDisabled();
    expect(input.closest("[inert]")).not.toBeNull();

    fireEvent.click(
      within(edit).getByRole("checkbox", {
        name: "Automatically organize files",
      }),
    );
    expect(input).toBeEnabled();
    expect(input.closest("[inert]")).toBeNull();
  });

  it("shows a readable message when a folder can't be added", async () => {
    tauri.pickMusicFolder.mockResolvedValue("/Volumes/Big/Music/Rock");
    tauri.addSource.mockRejectedValue(
      "source_overlap: /Volumes/Big/Music/Rock overlaps /Volumes/Big/Music",
    );
    await renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Add folder/ }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/overlaps one of your sources/);
    expect(alert.textContent).not.toMatch(/source_overlap/);
  });

  it("adds a picked folder", async () => {
    tauri.pickMusicFolder.mockResolvedValue("/Volumes/Big/Jazz");
    tauri.addSource.mockResolvedValue({
      ...sources[1],
      id: 4,
      name: "Jazz",
      rootPath: "/Volumes/Big/Jazz",
    });
    await renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Add folder/ }));
    await waitFor(() =>
      expect(tauri.addSource).toHaveBeenCalledWith("/Volumes/Big/Jazz"),
    );

    // Then its settings, to finish adding it as it is or adjusted.
    const dialog = await screen.findByRole("dialog", {
      name: "Add music source",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add folder" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(tauri.removeSource).not.toHaveBeenCalled();
  });

  it("finishes scanning a just-added folder before organizing it", async () => {
    const jazz = {
      ...sources[1],
      id: 4,
      name: "Jazz",
      rootPath: "/Volumes/Big/Jazz",
    };
    tauri.pickMusicFolder.mockResolvedValue("/Volumes/Big/Jazz");
    tauri.addSource.mockResolvedValue(jazz);
    tauri.setSourceOrganize.mockResolvedValue({ ...jazz, autoOrganize: true });
    tauri.rescanSource.mockResolvedValue({});
    usePlayerStore.setState({ library: [track(9, 4)] });
    await renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Add folder/ }));
    const dialog = await screen.findByRole("dialog", {
      name: "Add music source",
    });
    fireEvent.click(
      within(dialog).getByRole("checkbox", {
        name: "Automatically organize files",
      }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Add folder" }));
    await waitFor(() =>
      expect(tauri.applyOrganizeSource).toHaveBeenCalledWith(4, undefined),
    );
    expect(tauri.rescanSource).toHaveBeenCalledWith(4);
  });

  it("takes a just-added folder back out when adding is cancelled", async () => {
    tauri.pickMusicFolder.mockResolvedValue("/Volumes/Big/Jazz");
    tauri.addSource.mockResolvedValue({
      ...sources[1],
      id: 4,
      name: "Jazz",
      rootPath: "/Volumes/Big/Jazz",
    });
    tauri.removeSource.mockResolvedValue(0);
    await renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Add folder/ }));
    const dialog = await screen.findByRole("dialog", {
      name: "Add music source",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(tauri.removeSource).toHaveBeenCalledWith(4));
  });

  it("confirms removal, saying the files stay on disk", async () => {
    tauri.removeSource.mockResolvedValue(2);
    await renderSection();
    chooseFromMenu("Music", /Remove/);

    const dialog = await screen.findByRole("dialog", {
      name: "Remove music source?",
    });
    expect(dialog.textContent).toMatch(/2 tracks leave your library/);
    expect(dialog.textContent).toMatch(
      /playlist entries and listening history/,
    );
    expect(dialog.textContent).toMatch(/files on disk stay untouched/);
    expect(tauri.removeSource).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(tauri.removeSource).toHaveBeenCalledWith(3));
    await waitFor(() => expect(loadLibrary).toHaveBeenCalled());
  });

  it("shows the folder being removed and that its files stay", async () => {
    tauri.removeSource.mockResolvedValue(1);
    await renderSection();
    chooseFromMenu("Tracks", /Remove/);

    const dialog = await screen.findByRole("dialog", {
      name: "Remove music source?",
    });
    // The folder's path heads the prompt, above the explanation.
    const path = within(dialog).getByText("~/Music/Spiral Library/Tracks");
    const body = within(dialog).getByText(/1 track leaves your library/);
    expect(
      path.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(dialog.textContent).toMatch(/file on disk stays untouched/);
    expect(dialog.textContent).not.toMatch(/You can add it back later/);
    expect(dialog.textContent).toMatch(/It's your default folder/);

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(tauri.removeSource).toHaveBeenCalledWith(1));
  });
});

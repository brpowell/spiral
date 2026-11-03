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
import { useSourcesStore } from "../../store/useSourcesStore";
import type { LibrarySettings } from "../../types/library";
import type { FilePlanSummary, Source } from "../../types/source";
import type { Track } from "../../types/track";
import { SourcesSection } from "./SourcesSection";

const tauri = vi.hoisted(() => ({
  listSources: vi.fn(),
  getSourceStatuses: vi.fn(),
  addSource: vi.fn(),
  createManagedSource: vi.fn(),
  pickMusicFolder: vi.fn(),
  relocateSource: vi.fn(),
  removeSource: vi.fn(),
  rescanSource: vi.fn(),
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
    id: 2,
    rootPath: null,
    name: "External",
    autoOrganize: false,
    pathFormat: null,
    importTarget: false,
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

function item(name: string): HTMLElement {
  return screen.getByText(name).closest("li, section") as HTMLElement;
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
        organizePathFormat: "{albumArtist}/{album}/{title}.{ext}",
      } as LibrarySettings,
    });
    usePlayerStore.setState({
      library: [track(1, 1), track(2, 3), track(3, 3, "2026-10-01T12:00:00Z")],
      loadLibrary,
    });
  });

  async function renderSection() {
    render(<SourcesSection />);
    await screen.findByText("Music");
  }

  it("lists every source with its path and counts", async () => {
    await renderSection();

    const tracks = item("Tracks");
    expect(
      within(tracks).getByText("/Users/me/Music/Spiral Library/Tracks"),
    ).toBeTruthy();
    expect(within(tracks).getByText("1 track")).toBeTruthy();
    expect(within(item("Other files")).getByText("0 tracks")).toBeTruthy();

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

  it("shows Other apart from the folders", async () => {
    await renderSection();
    const list = screen.getAllByRole("list")[0];
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).queryByText("Other files")).toBeNull();
    expect(screen.getByRole("region", { name: "Other files" })).toBeTruthy();
  });

  it("shows an empty state with ways to add a folder when there are none", async () => {
    tauri.listSources.mockResolvedValue([sources[1]]);
    render(<SourcesSection />);
    expect(await screen.findByText("No music folders yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add folder/ })).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    // Other is still shown, and isn't counted as a folder.
    expect(screen.getByRole("region", { name: "Other files" })).toBeTruthy();

    tauri.createManagedSource.mockResolvedValue(sources[0]);
    fireEvent.click(
      screen.getByRole("button", { name: "Let Spiral manage a Tracks folder" }),
    );
    await waitFor(() => expect(tauri.createManagedSource).toHaveBeenCalled());
    await waitFor(() => expect(tauri.listSources).toHaveBeenCalledTimes(2));
  });

  it("keeps a folder card to its path and counts", async () => {
    await renderSection();
    const tracks = item("Tracks");
    expect(within(tracks).getByText("Default")).toBeTruthy();
    expect(within(tracks).queryByRole("checkbox")).toBeNull();
    expect(within(tracks).queryByLabelText("Path format")).toBeNull();
    expect(within(tracks).getAllByRole("button")).toHaveLength(1);
    expect(within(item("Music")).queryByText("Default")).toBeNull();
  });

  it("offers Edit, Rescan and Remove for every folder, Tracks included", async () => {
    await renderSection();
    expect(await menuItems("Tracks")).toEqual(["Edit…", "Rescan", "Remove…"]);
    expect(await menuItems("Music")).toEqual(["Edit…", "Rescan", "Remove…"]);
  });

  it("offers only Rescan for Other", async () => {
    await renderSection();
    expect(await menuItems("Other files")).toEqual(["Rescan"]);
  });

  it("rescans from the menu", async () => {
    tauri.rescanSource.mockResolvedValue({
      added: 1,
      updated: 0,
      missing: 0,
      restored: 0,
    });
    await renderSection();
    chooseFromMenu("Music", /Rescan/);
    await waitFor(() => expect(tauri.rescanSource).toHaveBeenCalledWith(3));
    expect(await screen.findByText(/Scan finished: 1 added/)).toBeTruthy();
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
      within(dialog).getByText("/Users/me/Music/Spiral Library/Tracks"),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("checkbox", {
        name: "Automatically organize files",
      }),
    ).toBeChecked();
    // Already the default: said plainly, with nothing to toggle.
    expect(
      within(dialog).getByText(/This is your default folder/),
    ).toBeTruthy();
    expect(
      within(dialog).queryByRole("checkbox", {
        name: "Make this the default folder",
      }),
    ).toBeNull();
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
    expect(within(dialog).getByText("Joni/Blue/Blue.flac")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Path format"), {
      target: { value: "{artist} - {title}.{ext}" },
    });
    expect(within(dialog).getByText("Joni - Blue.flac")).toBeTruthy();
  });

  it("lists tokens in a disclosure and inserts one at the cursor", async () => {
    await renderSection();
    const dialog = await openEdit("Music");
    expect(within(dialog).queryByText("Track title")).toBeNull();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Available tokens" }),
    );
    expect(within(dialog).getByText("Track title")).toBeTruthy();

    const input = within(dialog).getByLabelText(
      "Path format",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "{artist}/.{ext}" } });
    input.setSelectionRange(9, 9);
    fireEvent.click(within(dialog).getByRole("button", { name: "{title}" }));
    expect(input).toHaveValue("{artist}/{title}.{ext}");
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
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(tauri.setSourceOrganize).not.toHaveBeenCalled();
    expect(tauri.previewOrganizeSource).not.toHaveBeenCalled();
  });

  it("makes a folder the default", async () => {
    tauri.getSourceStatuses.mockResolvedValue([]);
    tauri.setImportSource.mockResolvedValue({
      ...sources[2],
      importTarget: true,
    });
    await renderSection();
    const dialog = await openEdit("Music");
    fireEvent.click(
      within(dialog).getByRole("checkbox", {
        name: "Make this the default folder",
      }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(tauri.setImportSource).toHaveBeenCalledWith(3));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("won't make an offline folder the default", async () => {
    await renderSection();
    await waitFor(() =>
      expect(within(item("Music")).getByText("Offline")).toBeTruthy(),
    );
    const dialog = await openEdit("Music");
    expect(
      within(dialog).getByRole("checkbox", {
        name: "Make this the default folder",
      }),
    ).toBeDisabled();
    expect(within(dialog).getByText(/Reconnect it/)).toBeTruthy();
  });

  it("changes a folder's location on Save", async () => {
    tauri.pickMusicFolder.mockResolvedValue("/Volumes/New/Music");
    tauri.relocateSource.mockResolvedValue({
      ...sources[2],
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

  it("previews before organizing a folder that has tracks", async () => {
    await renderSection();
    const edit = await openEdit("Music");
    fireEvent.click(
      within(edit).getByRole("checkbox", {
        name: "Automatically organize files",
      }),
    );
    fireEvent.click(within(edit).getByRole("button", { name: "Save" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Organize “Music”?",
    });
    expect(tauri.previewOrganizeSource).toHaveBeenCalledWith(3, undefined);
    expect(tauri.setSourceOrganize).not.toHaveBeenCalled();

    fireEvent.click(
      await within(dialog).findByRole("button", { name: "Move 2 files" }),
    );
    await waitFor(() =>
      expect(tauri.applyOrganizeSource).toHaveBeenCalledWith(3, undefined),
    );
    expect(await within(dialog).findByText(/Moved 2 files/)).toBeTruthy();
  });

  it("organizes with a new format in one preview", async () => {
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
    fireEvent.click(within(edit).getByRole("button", { name: "Save" }));
    await screen.findByRole("dialog", { name: "Organize “Music”?" });
    expect(tauri.previewOrganizeSource).toHaveBeenCalledWith(
      3,
      "{artist}/{title}.{ext}",
    );
  });

  it("leaves organize off when the preview is cancelled", async () => {
    await renderSection();
    const edit = await openEdit("Music");
    fireEvent.click(
      within(edit).getByRole("checkbox", {
        name: "Automatically organize files",
      }),
    );
    fireEvent.click(within(edit).getByRole("button", { name: "Save" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Organize “Music”?",
    });
    await within(dialog).findByRole("button", { name: "Move 2 files" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(tauri.applyOrganizeSource).not.toHaveBeenCalled();
    expect(tauri.setSourceOrganize).not.toHaveBeenCalled();
  });

  it("turns organize off without a preview", async () => {
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
    fireEvent.click(within(edit).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(tauri.setSourceOrganize).toHaveBeenCalledWith(1, false),
    );
    expect(tauri.previewOrganizeSource).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("turns organize on directly for a folder with no tracks", async () => {
    usePlayerStore.setState({ library: [track(1, 1)] });
    tauri.setSourceOrganize.mockResolvedValue({
      ...sources[2],
      autoOrganize: true,
    });
    await renderSection();
    const edit = await openEdit("Music");
    fireEvent.click(
      within(edit).getByRole("checkbox", {
        name: "Automatically organize files",
      }),
    );
    fireEvent.click(within(edit).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(tauri.setSourceOrganize).toHaveBeenCalledWith(3, true),
    );
    expect(tauri.previewOrganizeSource).not.toHaveBeenCalled();
  });

  it("previews a new format for an organized folder", async () => {
    await renderSection();
    const edit = await openEdit("Tracks");
    fireEvent.change(within(edit).getByLabelText("Path format"), {
      target: { value: "{artist}/{title}.{ext}" },
    });
    fireEvent.click(within(edit).getByRole("button", { name: "Save" }));
    await screen.findByRole("dialog", { name: "Organize “Tracks”?" });
    expect(tauri.previewOrganizeSource).toHaveBeenCalledWith(
      1,
      "{artist}/{title}.{ext}",
    );
    expect(tauri.setSourcePathFormat).not.toHaveBeenCalled();
  });

  it("goes back to the default format through the preview, then clears the override", async () => {
    tauri.listSources.mockResolvedValue([
      { ...sources[0], pathFormat: "{title}.{ext}" },
      sources[1],
      sources[2],
    ]);
    await renderSection();
    const edit = await openEdit("Tracks");
    const input = within(edit).getByLabelText("Path format");
    expect(input).toHaveValue("{title}.{ext}");
    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.click(within(edit).getByRole("button", { name: "Save" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Organize “Tracks”?",
    });
    expect(tauri.previewOrganizeSource).toHaveBeenCalledWith(
      1,
      "{albumArtist}/{album}/{title}.{ext}",
    );
    fireEvent.click(
      await within(dialog).findByRole("button", { name: "Move 2 files" }),
    );
    await waitFor(() =>
      expect(tauri.setSourcePathFormat).toHaveBeenCalledWith(1, null),
    );
  });

  it("saves a format for an unorganized folder without moving files", async () => {
    tauri.setSourcePathFormat.mockResolvedValue({
      ...sources[2],
      pathFormat: "{title}.{ext}",
    });
    await renderSection();
    const edit = await openEdit("Music");
    const input = within(edit).getByLabelText("Path format");
    fireEvent.change(input, { target: { value: "{title}.{ext}" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(tauri.setSourcePathFormat).toHaveBeenCalledWith(
        3,
        "{title}.{ext}",
      ),
    );
    expect(tauri.previewOrganizeSource).not.toHaveBeenCalled();
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
      ...sources[2],
      id: 4,
      name: "Jazz",
      rootPath: "/Volumes/Big/Jazz",
    });
    await renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Add folder/ }));
    await waitFor(() =>
      expect(tauri.addSource).toHaveBeenCalledWith("/Volumes/Big/Jazz"),
    );
  });

  it("confirms removal, saying the files stay on disk", async () => {
    tauri.removeSource.mockResolvedValue(2);
    await renderSection();
    chooseFromMenu("Music", /Remove/);

    const dialog = await screen.findByRole("dialog", {
      name: "Remove “Music”?",
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

  it("says removing Tracks keeps its folder and files on disk", async () => {
    tauri.removeSource.mockResolvedValue(1);
    await renderSection();
    chooseFromMenu("Tracks", /Remove/);

    const dialog = await screen.findByRole("dialog", {
      name: "Remove “Tracks”?",
    });
    expect(dialog.textContent).toMatch(/1 track leaves your library/);
    expect(dialog.textContent).toMatch(/files on disk stay untouched/);
    expect(dialog.textContent).toMatch(
      /folder and its files stay at \/Users\/me\/Music\/Spiral Library\/Tracks/,
    );
    expect(dialog.textContent).toMatch(/It's your default folder/);

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(tauri.removeSource).toHaveBeenCalledWith(1));
  });
});

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
    name: "Spiral",
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
  ({ id, title: `T${id}`, sourceId, missingSince }) as Track;

function item(name: string): HTMLElement {
  return screen.getByText(name).closest("li")!;
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

  it("gives the default source organize, a format and import controls, but no remove", async () => {
    await renderSection();
    const tracks = item("Tracks");
    expect(
      within(tracks).getByRole("switch", { name: "Organize files" }),
    ).toBeChecked();
    expect(within(tracks).getByLabelText("Path format")).toHaveAttribute(
      "placeholder",
      "Use default format",
    );
    expect(
      within(tracks).getByText("{albumArtist}/{album}/{title}.{ext}"),
    ).toBeTruthy();
    expect(within(tracks).getByText("Import target")).toBeTruthy();
    expect(
      within(tracks).queryByRole("button", { name: /Import here/ }),
    ).toBeNull();
    expect(within(tracks).queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(
      within(tracks).queryByRole("button", { name: /Change location/ }),
    ).toBeNull();
  });

  it("gives a user source every control", async () => {
    await renderSection();
    const music = item("Music");
    expect(
      within(music).getByRole("switch", { name: "Organize files" }),
    ).not.toBeChecked();
    expect(within(music).getByLabelText("Path format")).toBeTruthy();
    expect(within(music).getByRole("button", { name: /Rescan/ })).toBeTruthy();
    expect(
      within(music).getByRole("button", { name: /Change location/ }),
    ).toBeTruthy();
    expect(within(music).getByRole("button", { name: /Remove/ })).toBeTruthy();
    expect(within(music).queryByText("Import target")).toBeNull();
  });

  it("gives Other no organize, format, import or remove controls", async () => {
    await renderSection();
    const other = item("Other files");
    expect(within(other).queryByRole("switch")).toBeNull();
    expect(within(other).queryByLabelText("Path format")).toBeNull();
    expect(
      within(other).queryByRole("button", { name: /Import here/ }),
    ).toBeNull();
    expect(within(other).queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(within(other).getByRole("button", { name: /Rescan/ })).toBeTruthy();
  });

  it("has no writable switch or read-only badge", async () => {
    await renderSection();
    expect(screen.queryByText(/Read-only/)).toBeNull();
    expect(screen.queryByText(/edit tags in this folder/)).toBeNull();
  });

  it("makes a source the import target", async () => {
    tauri.getSourceStatuses.mockResolvedValue([]);
    tauri.setImportSource.mockResolvedValue({
      ...sources[2],
      importTarget: true,
    });
    await renderSection();
    fireEvent.click(
      within(item("Music")).getByRole("button", { name: /Import here/ }),
    );
    await waitFor(() => expect(tauri.setImportSource).toHaveBeenCalledWith(3));
    expect(tauri.listSources).toHaveBeenCalledTimes(2);
  });

  it("previews before organizing a source that has tracks", async () => {
    await renderSection();
    fireEvent.click(
      within(item("Music")).getByRole("switch", { name: "Organize files" }),
    );
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

  it("leaves organize off when the preview is cancelled", async () => {
    await renderSection();
    fireEvent.click(
      within(item("Music")).getByRole("switch", { name: "Organize files" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Organize “Music”?",
    });
    await within(dialog).findByRole("button", { name: "Move 2 files" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(tauri.applyOrganizeSource).not.toHaveBeenCalled();
    expect(tauri.setSourceOrganize).not.toHaveBeenCalled();
    expect(
      within(item("Music")).getByRole("switch", { name: "Organize files" }),
    ).not.toBeChecked();
  });

  it("turns organize off without a preview", async () => {
    tauri.setSourceOrganize.mockResolvedValue({
      ...sources[0],
      autoOrganize: false,
    });
    await renderSection();
    fireEvent.click(
      within(item("Tracks")).getByRole("switch", { name: "Organize files" }),
    );
    await waitFor(() =>
      expect(tauri.setSourceOrganize).toHaveBeenCalledWith(1, false),
    );
    expect(tauri.previewOrganizeSource).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("turns organize on directly for a source with no tracks", async () => {
    usePlayerStore.setState({ library: [track(1, 1)] });
    tauri.setSourceOrganize.mockResolvedValue({
      ...sources[2],
      autoOrganize: true,
    });
    await renderSection();
    fireEvent.click(
      within(item("Music")).getByRole("switch", { name: "Organize files" }),
    );
    await waitFor(() =>
      expect(tauri.setSourceOrganize).toHaveBeenCalledWith(3, true),
    );
    expect(tauri.previewOrganizeSource).not.toHaveBeenCalled();
  });

  it("previews a new format for an organized source", async () => {
    await renderSection();
    const input = within(item("Tracks")).getByLabelText("Path format");
    fireEvent.change(input, { target: { value: "{artist}/{title}.{ext}" } });
    fireEvent.blur(input);
    const dialog = await screen.findByRole("dialog", {
      name: "Organize “Tracks”?",
    });
    expect(tauri.previewOrganizeSource).toHaveBeenCalledWith(
      1,
      "{artist}/{title}.{ext}",
    );
    expect(tauri.setSourcePathFormat).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(item("Tracks")).getByLabelText("Path format")).toHaveValue(
      "",
    );
  });

  it("goes back to the default format through the preview, then clears the override", async () => {
    tauri.listSources.mockResolvedValue([
      { ...sources[0], pathFormat: "{title}.{ext}" },
      sources[1],
      sources[2],
    ]);
    await renderSection();
    const input = within(item("Tracks")).getByLabelText("Path format");
    expect(input).toHaveValue("{title}.{ext}");
    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.blur(input);
    const dialog = await screen.findByRole("dialog");
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

  it("saves a format for an unorganized source without moving files", async () => {
    tauri.setSourcePathFormat.mockResolvedValue({
      ...sources[2],
      pathFormat: "{title}.{ext}",
    });
    await renderSection();
    const input = within(item("Music")).getByLabelText("Path format");
    fireEvent.change(input, { target: { value: "{title}.{ext}" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
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
    fireEvent.click(
      within(item("Music")).getByRole("button", { name: /Remove/ }),
    );

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
});

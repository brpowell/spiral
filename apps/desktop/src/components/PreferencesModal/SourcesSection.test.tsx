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
import type { Source } from "../../types/source";
import type { Track } from "../../types/track";
import { SourcesSection } from "./SourcesSection";

const tauri = vi.hoisted(() => ({
  listSources: vi.fn(),
  getSourceStatuses: vi.fn(),
  addWatchedSource: vi.fn(),
  pickMusicFolder: vi.fn(),
  relocateWatchedSource: vi.fn(),
  removeWatchedSource: vi.fn(),
  rescanSource: vi.fn(),
  setSourceWritable: vi.fn(),
}));

vi.mock("../../lib/tauri", () => tauri);

const sources: Source[] = [
  {
    id: 1,
    kind: "managed",
    rootPath: null,
    name: "Spiral",
    writable: true,
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: 2,
    kind: "external",
    rootPath: null,
    name: "External",
    writable: false,
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: 3,
    kind: "watched",
    rootPath: "/Volumes/Big/Music",
    name: "Music",
    writable: false,
    createdAt: "2026-01-01T00:00:00Z",
  },
];

const track = (id: number, sourceId: number, missingSince?: string) =>
  ({ id, title: `T${id}`, sourceId, missingSince }) as Track;

function item(name: string): HTMLElement {
  return screen.getByText(name).closest("li")!;
}

describe("SourcesSection", () => {
  const loadLibrary = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    tauri.listSources.mockResolvedValue(sources);
    tauri.getSourceStatuses.mockResolvedValue([
      { sourceId: 3, status: "unreachable" },
    ]);
    useSourcesStore.setState({
      sources: [],
      sourcesById: new Map(),
      statuses: {},
    });
    useLibrarySettingsStore.setState({
      settings: {
        mediaFolder: "/Users/me/Music/Spiral Library/Tracks",
      } as LibrarySettings,
    });
    usePlayerStore.setState({
      library: [track(1, 1), track(2, 3), track(3, 3, "2026-10-01T12:00:00Z")],
      loadLibrary,
    });
  });

  it("lists every source with its path and counts", async () => {
    render(<SourcesSection />);
    await screen.findByText("Music");

    const managed = item("Spiral library");
    expect(
      within(managed).getByText("/Users/me/Music/Spiral Library/Tracks"),
    ).toBeTruthy();
    expect(within(managed).getByText("1 track")).toBeTruthy();
    expect(within(item("Other files")).getByText("0 tracks")).toBeTruthy();

    const watched = item("Music");
    expect(within(watched).getByText("/Volumes/Big/Music")).toBeTruthy();
    expect(within(watched).getByText(/^2 tracks/)).toBeTruthy();
    expect(within(watched).getByText("1 missing")).toBeTruthy();
  });

  it("flags an unreachable watched folder as offline", async () => {
    render(<SourcesSection />);
    await screen.findByText("Music");
    const watched = item("Music");
    await waitFor(() =>
      expect(within(watched).getByText("Offline")).toBeTruthy(),
    );
    expect(within(item("Spiral library")).queryByText("Offline")).toBeNull();
  });

  it("only offers folder actions for watched folders", async () => {
    render(<SourcesSection />);
    await screen.findByText("Music");
    expect(
      within(item("Spiral library")).queryByRole("button", {
        name: /Remove/,
      }),
    ).toBeNull();
    expect(within(item("Spiral library")).queryByRole("switch")).toBeNull();
    const watched = item("Music");
    expect(
      within(watched).getByRole("button", { name: /Change location/ }),
    ).toBeTruthy();
    expect(
      within(watched).getByRole("switch", {
        name: "Allow Spiral to edit tags in this folder",
      }),
    ).toBeTruthy();
  });

  it("toggles the writable flag", async () => {
    tauri.setSourceWritable.mockResolvedValue({
      ...sources[2],
      writable: true,
    });
    render(<SourcesSection />);
    await screen.findByText("Music");
    fireEvent.click(
      within(item("Music")).getByRole("switch", {
        name: "Allow Spiral to edit tags in this folder",
      }),
    );
    await waitFor(() =>
      expect(tauri.setSourceWritable).toHaveBeenCalledWith(3, true),
    );
    await waitFor(() =>
      expect(useSourcesStore.getState().sourcesById.get(3)?.writable).toBe(
        true,
      ),
    );
  });

  it("shows a readable message when a folder can't be added", async () => {
    tauri.pickMusicFolder.mockResolvedValue("/Volumes/Big/Music/Rock");
    tauri.addWatchedSource.mockRejectedValue(
      "source_overlap: /Volumes/Big/Music/Rock overlaps the watched folder /Volumes/Big/Music",
    );
    render(<SourcesSection />);
    await screen.findByText("Music");
    fireEvent.click(screen.getByRole("button", { name: /Add folder/ }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(
      /overlaps a folder Spiral already watches/,
    );
    expect(alert.textContent).not.toMatch(/source_overlap/);
  });

  it("adds a picked folder", async () => {
    tauri.pickMusicFolder.mockResolvedValue("/Volumes/Big/Jazz");
    tauri.addWatchedSource.mockResolvedValue({
      ...sources[2],
      id: 4,
      name: "Jazz",
      rootPath: "/Volumes/Big/Jazz",
    });
    render(<SourcesSection />);
    await screen.findByText("Music");
    fireEvent.click(screen.getByRole("button", { name: /Add folder/ }));
    await waitFor(() =>
      expect(tauri.addWatchedSource).toHaveBeenCalledWith("/Volumes/Big/Jazz"),
    );
  });

  it("confirms removal, saying the files stay on disk", async () => {
    tauri.removeWatchedSource.mockResolvedValue(2);
    render(<SourcesSection />);
    await screen.findByText("Music");
    fireEvent.click(
      within(item("Music")).getByRole("button", { name: /Remove/ }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Stop watching “Music”?",
    });
    expect(dialog.textContent).toMatch(/2 tracks leave your Spiral library/);
    expect(dialog.textContent).toMatch(
      /playlist entries and listening history/,
    );
    expect(dialog.textContent).toMatch(/files on disk stay untouched/);
    expect(tauri.removeWatchedSource).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Stop watching" }),
    );
    await waitFor(() =>
      expect(tauri.removeWatchedSource).toHaveBeenCalledWith(3),
    );
    await waitFor(() => expect(loadLibrary).toHaveBeenCalled());
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOnboardingStore } from "../../../store/useOnboardingStore";
import { useSourcesStore } from "../../../store/useSourcesStore";
import type { Source } from "../../../types/source";
import { FoldersStep } from "./FoldersStep";

const tauri = vi.hoisted(() => ({
  pickMusicFolder: vi.fn(),
  addSource: vi.fn(),
  removeSource: vi.fn(),
  listSources: vi.fn(),
}));
const player = vi.hoisted(() => ({ loadLibrary: vi.fn() }));

vi.mock("../../../lib/tauri", () => tauri);
vi.mock("../../../store/usePlayerStore", () => ({
  usePlayerStore: { getState: () => player },
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

const builtIns = [
  source({ id: 1, name: "Tracks", rootPath: "/Users/me/Spiral/Tracks" }),
  source({ id: 2, name: "Other", rootPath: null }),
];

describe("FoldersStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOnboardingStore.setState({ addedSourceIds: [] });
    useSourcesStore.setState({
      sources: builtIns,
      sourcesById: new Map(builtIns.map((s) => [s.id, s])),
    });
    tauri.pickMusicFolder.mockResolvedValue("/Users/me/Music");
    tauri.addSource.mockResolvedValue(source({}));
    tauri.removeSource.mockResolvedValue(0);
    tauri.listSources.mockResolvedValue(builtIns);
  });

  it("starts with just the Add folder button", () => {
    render(<FoldersStep />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("button", { name: "Add folder" })).toBeEnabled();
  });

  it("adds each picked folder to the list above the button", async () => {
    render(<FoldersStep />);
    fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
    await waitFor(() =>
      expect(tauri.addSource).toHaveBeenCalledWith("/Users/me/Music"),
    );
    expect(await screen.findByText("Music")).toBeInTheDocument();

    tauri.pickMusicFolder.mockResolvedValue("/Volumes/Archive");
    tauri.addSource.mockResolvedValue(
      source({ id: 4, name: "Archive", rootPath: "/Volumes/Archive" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
    expect(await screen.findByText("Archive")).toBeInTheDocument();

    const items = screen
      .getByRole("list", { name: "Your music folders" })
      .querySelectorAll("li");
    expect([...items].map((li) => li.textContent)).toEqual([
      "Music/Users/me/Music",
      "Archive/Volumes/Archive",
    ]);
    // Built-in sources aren't the user's folders.
    expect(screen.queryByText("Tracks")).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Music" }),
    );
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
      sources: [...builtIns, existing],
      sourcesById: new Map([...builtIns, existing].map((s) => [s.id, s])),
    });
    render(<FoldersStep />);
    expect(screen.getByText("Old")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Old" })).toBeNull();
  });

  it("explains why a folder can't be removed", async () => {
    tauri.removeSource.mockRejectedValue("source_not_found: 3");
    render(<FoldersStep />);
    fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Music" }),
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Music")).toBeInTheDocument();
  });
});

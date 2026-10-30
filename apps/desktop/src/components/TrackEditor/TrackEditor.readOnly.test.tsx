import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Every backend call resolves to nothing; this test only looks at gating.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
  convertFileSrc: (path: string) => `asset://${path}`,
  Channel: class {},
}));

import { useLibrarySettingsStore } from "../../store/useLibrarySettingsStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useSourcesStore } from "../../store/useSourcesStore";
import type { Source } from "../../types/source";
import type { Track } from "../../types/track";
import { TrackEditor } from "./TrackEditor";

const watched: Source = {
  id: 3,
  kind: "watched",
  rootPath: "/Music",
  name: "Music",
  writable: false,
  createdAt: "2026-01-01T00:00:00Z",
};

function track(sourceId: number): Track {
  return {
    id: 7,
    title: "Song",
    artist: "Artist",
    album: "Album",
    albumArtist: null,
    trackNumber: 1,
    totalTracks: null,
    discNumber: null,
    totalDiscs: null,
    year: null,
    genre: null,
    durationSeconds: 180,
    sampleRate: null,
    bitrate: null,
    codec: null,
    filePath: "/Music/song.mp3",
    artPath: null,
    dateAdded: "2026-01-01",
    playCount: 0,
    lastPlayedAt: null,
    rating: 0,
    sourceId,
    missingSince: null,
  };
}

function openEditor(sourceId: number) {
  usePlayerStore.setState({
    library: [track(sourceId)],
    editingTrackIds: [7],
    trackEditorInitialTab: "details",
  });
  render(<TrackEditor />);
}

describe("TrackEditor read-only gating", () => {
  beforeEach(() => {
    useSourcesStore.setState({ sourcesById: new Map([[3, watched]]) });
  });

  it("edits tracks Spiral may write", async () => {
    openEditor(1);
    const title = await screen.findByDisplayValue("Song");
    expect(title).not.toBeDisabled();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("opens read-only for a read-only watched folder, pointing at its toggle", async () => {
    const openPreferences = vi.fn();
    useLibrarySettingsStore.setState({ openPreferences });
    openEditor(3);

    const title = await screen.findByDisplayValue("Song");
    expect(title).toBeDisabled();
    expect(screen.getByRole("note").textContent).toMatch(
      /“Music”, which Spiral can only read/,
    );
    expect(screen.getByRole("button", { name: /Save/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Folder settings…" }));
    expect(openPreferences).toHaveBeenCalledWith("sources");
  });

  it("explains external files without a folder setting", async () => {
    openEditor(2);
    expect(await screen.findByDisplayValue("Song")).toBeDisabled();
    expect(screen.getByRole("note").textContent).toMatch(
      /outside the Spiral library/,
    );
    expect(
      screen.queryByRole("button", { name: "Folder settings…" }),
    ).toBeNull();
  });
});

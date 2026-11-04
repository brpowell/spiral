import { describe, expect, it, vi } from "vitest";

vi.mock("./artPath", () => ({
  fileExists: vi.fn().mockResolvedValue(true),
}));

import type { Track } from "../types/track";
import {
  isTrackMissingFile,
  mergeLibraryClientState,
  missingFileLabel,
} from "./missingFileTrack";

const track = (patch: Partial<Track> = {}) =>
  ({ id: 1, title: "Song", filePath: "/m/a.mp3", ...patch }) as Track;

describe("missing tracks", () => {
  it("counts a scan's missing mark as well as the playback flag", () => {
    expect(isTrackMissingFile(track())).toBe(false);
    expect(isTrackMissingFile(track({ missingFile: true }))).toBe(true);
    expect(
      isTrackMissingFile(track({ missingSince: "2026-10-01T12:00:00Z" })),
    ).toBe(true);
    expect(isTrackMissingFile(track({ missingSince: null }))).toBe(false);
  });

  it("says since when, when a scan recorded it", () => {
    expect(missingFileLabel({ missingSince: null })).toBe("File missing");
    expect(missingFileLabel({ missingSince: "2026-10-01T12:00:00Z" })).toMatch(
      /^File missing since /,
    );
  });

  it("keeps the playback flag across reloads until a scan finds the file", () => {
    const flagged = track({ missingFile: true });
    expect(mergeLibraryClientState([flagged], [track()])[0]?.missingFile).toBe(
      true,
    );

    const markedByScan = track({
      missingFile: true,
      missingSince: "2026-10-01T12:00:00Z",
    });
    const restored = track({ missingSince: null });
    expect(
      mergeLibraryClientState([markedByScan], [restored])[0]?.missingFile,
    ).toBeUndefined();
  });
});

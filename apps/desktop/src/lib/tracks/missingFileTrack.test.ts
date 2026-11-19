import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/art/artPath", () => ({
  fileExists: vi.fn().mockResolvedValue(true),
}));

import type { Track } from "@/types/track";
import {
  isTrackMissingFile,
  mergeLibraryClientState,
  missingFileLabel,
  withTrackMissingFile,
  withTrackSourceOffline,
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

  it("says when the music folder is offline rather than the file gone", () => {
    expect(missingFileLabel({ missingSince: null, sourceOffline: true })).toBe(
      "Music folder offline",
    );
    // Even when a scan had recorded the file missing too.
    expect(
      missingFileLabel({
        missingSince: "2026-10-01T12:00:00Z",
        sourceOffline: true,
      }),
    ).toBe("Music folder offline");
  });

  it("flags a track offline, and clearing the missing flag clears that too", () => {
    const offline = withTrackSourceOffline(track());
    expect(offline).toMatchObject({ missingFile: true, sourceOffline: true });
    expect(isTrackMissingFile(offline)).toBe(true);
    expect(withTrackSourceOffline(offline)).toBe(offline);

    const back = withTrackMissingFile(offline, false);
    expect(back.missingFile).toBeUndefined();
    expect(back.sourceOffline).toBeUndefined();
  });

  it("drops an offline guess on reload but keeps a file's own flag", () => {
    const offline = withTrackSourceOffline(track());
    const reloaded = mergeLibraryClientState([offline], [track()])[0];
    expect(reloaded?.missingFile).toBeUndefined();
    expect(reloaded?.sourceOffline).toBeUndefined();
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

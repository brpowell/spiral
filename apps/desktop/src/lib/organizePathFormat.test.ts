import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORGANIZE_PATH_FORMAT,
  formatOrganizeRelativePath,
  GENERIC_ORGANIZE_PATH_SAMPLE,
  sanitizeFilename,
} from "./organizePathFormat";

describe("formatOrganizeRelativePath", () => {
  it("formats default path with zero-padded track number", () => {
    expect(
      formatOrganizeRelativePath(DEFAULT_ORGANIZE_PATH_FORMAT, {
        ...GENERIC_ORGANIZE_PATH_SAMPLE,
        trackNumber: 8,
        title: "LOYALTY.",
      }),
    ).toBe("Example Artist/Example Album/08 - LOYALTY..mp3");
  });

  it("omits missing track number from default-style format", () => {
    expect(
      formatOrganizeRelativePath(DEFAULT_ORGANIZE_PATH_FORMAT, {
        ...GENERIC_ORGANIZE_PATH_SAMPLE,
        trackNumber: null,
      }),
    ).toBe("Example Artist/Example Album/Example Song.mp3");
  });

  it("uses album artist for folder segment", () => {
    const sample = {
      ...GENERIC_ORGANIZE_PATH_SAMPLE,
      title: "LOYALTY.",
      artist: "Kendrick Lamar / Rihanna",
      albumArtist: "Kendrick Lamar",
      album: "DAMN.",
      trackNumber: 8,
      extension: "mp3",
    };
    expect(formatOrganizeRelativePath(DEFAULT_ORGANIZE_PATH_FORMAT, sample)).toBe(
      "Kendrick Lamar/DAMN./08 - LOYALTY..mp3",
    );
  });

  it("supports custom path layouts", () => {
    expect(
      formatOrganizeRelativePath("{artist}/{year} - {album}/{title}.{ext}", {
        ...GENERIC_ORGANIZE_PATH_SAMPLE,
        year: 2024,
      }),
    ).toBe("Example Artist/2024 - Example Album/Example Song.mp3");
  });
});

describe("sanitizeFilename", () => {
  it("strips path separators", () => {
    expect(sanitizeFilename("AC/DC")).toBe("ACDC");
  });

  it("strips Windows-invalid characters", () => {
    expect(sanitizeFilename("Track: <Bad>?|*")).toBe("Track Bad");
  });
});

describe("path safety", () => {
  it("drops dot-dot segments from format", () => {
    expect(
      formatOrganizeRelativePath("{albumArtist}/../outside/{title}.{ext}", {
        ...GENERIC_ORGANIZE_PATH_SAMPLE,
        title: "Song",
      }),
    ).toBe("Example Artist/outside/Song.mp3");
  });

  it("suffixes Windows reserved device names", () => {
    expect(
      formatOrganizeRelativePath("{title}.{ext}", {
        ...GENERIC_ORGANIZE_PATH_SAMPLE,
        title: "CON",
      }),
    ).toBe("CON_.mp3");
  });
});

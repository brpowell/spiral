import { describe, expect, it } from "vitest";
import {
  BUILTIN_ENCODING_PROFILES,
  DEFAULT_CD_IMPORT_PROFILE_ID,
  encodingProfileOptionsForConvert,
  formatSourceEncodingProfileLabel,
  getEncodingProfile,
  inferDefaultConvertProfileId,
  isKnownEncodingProfileId,
} from "./encodingProfiles";

describe("BUILTIN_ENCODING_PROFILES", () => {
  it("lists the five curated built-in profiles", () => {
    expect(BUILTIN_ENCODING_PROFILES.map((profile) => profile.id)).toEqual([
      "lossless-flac",
      "apple-alac",
      "apple-aac",
      "mp3-high",
      "mp3-compact",
    ]);
  });

  it("includes label, subtitle, and extension for each profile", () => {
    expect(BUILTIN_ENCODING_PROFILES).toEqual([
      {
        id: "lossless-flac",
        label: "Lossless (FLAC)",
        subtitle: "Best quality for your library",
        extension: "flac",
      },
      {
        id: "apple-alac",
        label: "Apple Lossless (ALAC)",
        subtitle: ".m4a for iTunes and Apple devices",
        extension: "m4a",
      },
      {
        id: "apple-aac",
        label: "Apple Device (AAC)",
        subtitle: ".m4a for iPod, iPhone, and iTunes",
        extension: "m4a",
      },
      {
        id: "mp3-high",
        label: "MP3 - High (320)",
        subtitle: "Works on almost any player",
        extension: "mp3",
      },
      {
        id: "mp3-compact",
        label: "MP3 - Compact (128)",
        subtitle: "Smaller files, more songs per device",
        extension: "mp3",
      },
    ]);
  });
});

describe("getEncodingProfile", () => {
  it("returns a profile by id", () => {
    expect(getEncodingProfile("apple-aac")?.label).toBe("Apple Device (AAC)");
    expect(getEncodingProfile("apple-alac")?.label).toBe(
      "Apple Lossless (ALAC)",
    );
  });

  it("returns undefined for unknown ids", () => {
    expect(getEncodingProfile("vorbis")).toBeUndefined();
  });
});

describe("encoding profile helpers", () => {
  it("defaults CD import to lossless FLAC", () => {
    expect(DEFAULT_CD_IMPORT_PROFILE_ID).toBe("lossless-flac");
  });

  it("validates profile ids", () => {
    expect(isKnownEncodingProfileId("mp3-high")).toBe(true);
    expect(isKnownEncodingProfileId("apple-alac")).toBe(true);
    expect(isKnownEncodingProfileId("custom")).toBe(false);
  });

  it("formats source encoding labels from profile id or codec", () => {
    expect(
      formatSourceEncodingProfileLabel({ sourceProfileId: "apple-alac" }),
    ).toBe("Apple Lossless (ALAC)");
    expect(formatSourceEncodingProfileLabel({ codec: "alac" })).toBe(
      "Apple Lossless (ALAC)",
    );
    expect(
      formatSourceEncodingProfileLabel({ sourceProfileId: "lossless-flac" }),
    ).toBe("Lossless (FLAC)");
  });
});

describe("convert profile options", () => {
  it("omits no-op and disallowed profiles via extension fallback", () => {
    expect(
      encodingProfileOptionsForConvert(["/music/album/track.m4a"]).map(
        (option) => option.value,
      ),
    ).toEqual(["mp3-high", "mp3-compact"]);
    expect(
      encodingProfileOptionsForConvert(["/music/album/track.flac"]).map(
        (option) => option.value,
      ),
    ).toEqual(["apple-alac", "apple-aac", "mp3-high", "mp3-compact"]);
    expect(
      encodingProfileOptionsForConvert(["/music/album/track.mp3"]).map(
        (option) => option.value,
      ),
    ).toEqual(["apple-aac", "mp3-high", "mp3-compact"]);
  });

  it("requires every selected track to allow the target profile", () => {
    expect(
      encodingProfileOptionsForConvert([
        "/music/album/a.flac",
        "/music/album/b.mp3",
      ]).map((option) => option.value),
    ).toEqual(["apple-aac", "mp3-high", "mp3-compact"]);
  });
});

describe("inferDefaultConvertProfileId", () => {
  it("prefers a different allowed format from the source file", () => {
    expect(inferDefaultConvertProfileId("/music/album/track.flac")).toBe(
      "apple-alac",
    );
    expect(inferDefaultConvertProfileId("/music/album/track.m4a")).toBe(
      "mp3-high",
    );
    expect(inferDefaultConvertProfileId("/music/album/track.mp3")).toBe(
      "apple-aac",
    );
  });
});

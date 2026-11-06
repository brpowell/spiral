import { describe, expect, it } from "vitest";
import type { Track } from "../types/track";
import { findTrack, missingDevices, trackRef } from "./stageState";

const track = (over: Partial<Track>): Track =>
  ({
    id: 1,
    title: "In Bloom",
    artist: "Nirvana",
    album: "Nevermind",
    ...over,
  }) as Track;

describe("findTrack", () => {
  const library = [
    track({ id: 1 }),
    track({ id: 2, album: "Live" }),
    track({ id: 3, title: "On A Plain" }),
  ];

  it("matches title, artist and album case-insensitively", () => {
    const ref = { title: "in bloom", artist: "NIRVANA", album: "live" };
    expect(findTrack(library, ref)?.id).toBe(2);
  });

  it("ignores null artist/album in the ref", () => {
    expect(
      findTrack(library, { title: "On A Plain", artist: null, album: null })
        ?.id,
    ).toBe(3);
  });

  it("returns undefined when nothing matches", () => {
    expect(
      findTrack(library, { title: "Nope", artist: null, album: null }),
    ).toBeUndefined();
  });

  it("round-trips through trackRef", () => {
    expect(findTrack(library, trackRef(library[1]))?.id).toBe(2);
  });
});

describe("missingDevices", () => {
  it("accepts a count when enough devices are visible, whatever they are called", () => {
    expect(missingDevices(1, ["Any Disc Title"])).toBeNull();
    expect(missingDevices(1, ["Some Other Album"])).toBeNull();
    expect(missingDevices(0, [])).toBeNull();
  });

  it("reports a count shortfall", () => {
    expect(missingDevices(1, [])).toMatch(
      /expected 1 device in the sidebar, found 0/,
    );
    expect(missingDevices(2, ["A"])).toMatch(/expected 2 devices/);
  });

  it("names the missing devices for a list", () => {
    expect(
      missingDevices(["Human After All", "Discovery"], ["Human After All"]),
    ).toMatch(/"Discovery"/);
  });

  it("matches names case-insensitively by substring", () => {
    expect(
      missingDevices(["human after all"], ["Human After All  Eject"]),
    ).toBeNull();
  });
});

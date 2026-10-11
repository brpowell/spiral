import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIBRARY_ICON_ID,
  getLibraryIcon,
  humanizeIconId,
  listLibraryIcons,
  resolveIcon,
  resolveIconId,
  searchLibraryIcons,
  iconsWithTag,
  sortLibraryIconsByTag,
} from "./index";

describe("iconLibrary", () => {
  it("registers app chrome icons with skin-compatible ids", () => {
    expect(resolveIcon("setList")).toBeDefined();
    expect(resolveIcon("alwaysOnTop")).toBeDefined();
    expect(resolveIcon("chevronLeft")).toBeDefined();
    expect(resolveIcon("visualizer")).toBe(resolveIcon("audioWaveform"));
  });

  it("registers cover / mood extras", () => {
    expect(resolveIcon("note")).toBeDefined();
    expect(resolveIcon("headphones")).toBeDefined();
    expect(resolveIcon("sparkles")).toBeDefined();
  });

  it("resolves aliases to canonical ids", () => {
    expect(resolveIconId("mic")).toBe("microphone");
    expect(resolveIcon("mic")).toBe(resolveIcon("microphone"));
  });

  it("falls unknown ids back to the default", () => {
    expect(resolveIconId("not-a-real-icon")).toBe(DEFAULT_LIBRARY_ICON_ID);
    expect(resolveIconId(null)).toBe(DEFAULT_LIBRARY_ICON_ID);
  });

  it("filters by tag", () => {
    const music = iconsWithTag("music");
    expect(music.length).toBeGreaterThan(0);
    expect(music.every((icon) => icon.tags.includes("music"))).toBe(true);
  });

  it("searches by id and tags", () => {
    const byId = searchLibraryIcons("headphones");
    expect(byId.some((i) => i.id === "headphones")).toBe(true);

    const byTag = searchLibraryIcons("playback");
    expect(byTag.length).toBeGreaterThan(0);
    expect(byTag.every((i) => i.tags.some((t) => t.includes("playback")))).toBe(
      true,
    );
  });

  it("sorts matching tags first without filtering", () => {
    const sorted = sortLibraryIconsByTag("cover");
    expect(sorted.length).toBe(listLibraryIcons().length);
    expect(sorted[0]!.tags.includes("cover")).toBe(true);
    const firstNonCover = sorted.findIndex((i) => !i.tags.includes("cover"));
    expect(firstNonCover).toBeGreaterThan(0);
    expect(
      sorted.slice(0, firstNonCover).every((i) => i.tags.includes("cover")),
    ).toBe(true);
    expect(
      sorted.slice(firstNonCover).every((i) => !i.tags.includes("cover")),
    ).toBe(true);
  });

  it("humanizes camelCase ids", () => {
    expect(humanizeIconId("setList")).toBe("Set List");
    expect(humanizeIconId("headphones")).toBe("Headphones");
  });

  it("exposes a sorted full catalog", () => {
    const list = listLibraryIcons();
    expect(list.length).toBeGreaterThan(50);
    expect(getLibraryIcon(list[0]!.id)).toEqual(list[0]);
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1]!.id.localeCompare(list[i]!.id)).toBeLessThanOrEqual(0);
    }
  });
});

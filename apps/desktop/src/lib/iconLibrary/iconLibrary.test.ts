import { afterEach, describe, expect, it, vi } from "vitest";
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
  applyIconTagTable,
  getIconLibraryVersion,
  setLibraryIconTags,
  subscribeIconLibrary,
} from "./index";

describe("iconLibrary", () => {
  it("registers app chrome icons with skin-compatible ids", () => {
    expect(resolveIcon("setList")).toBeDefined();
    expect(resolveIcon("alwaysOnTop")).toBeDefined();
    expect(resolveIcon("chevronLeft")).toBeDefined();
    expect(resolveIcon("visualizer")).toBe(resolveIcon("audioWaveform"));
  });

  it("lists the Lucide cover icons first in the picker order", () => {
    const ids = [
      "rocket",
      "trophy",
      "thumbsUp",
      "award",
      "sparkle",
      "earth",
      "plane",
      "compass",
      "sprout",
      "swords",
      "apple",
      "dumbbell",
      "clapperboard",
      "crosshair",
      "puzzle",
      "church",
      "rose",
      "guitar",
      "croissant",
      "cherry",
      "gamepad",
      "gamepad2",
      "pawPrint",
      "school",
      "atom",
      "hamburger",
      "snowflake",
      "chefHat",
      "handHeart",
      "cat",
      "ghost",
      "drama",
      "paintbrush",
      "mop",
      "store",
      "shoppingBag",
      "shirt",
      "cake",
      "lollipop",
      "banknote",
      "car",
      "microphone",
    ];
    const covers = new Set(iconsWithTag("cover").map((icon) => icon.id));
    for (const id of ids) {
      expect(resolveIcon(id), id).toBeDefined();
      expect(covers.has(id), `${id} is tagged cover`).toBe(true);
    }
  });

  it("finds the cover icons by everyday words, not just their ids", () => {
    const find = (q: string) => searchLibraryIcons(q).map((icon) => icon.id);
    expect(find("birthday")).toContain("cake");
    expect(find("gym")).toContain("dumbbell");
    expect(find("halloween")).toContain("ghost");
    expect(find("clothes")).toContain("shirt");
    expect(find("movie")).toContain("clapperboard");
    expect(find("candy")).toContain("lollipop");
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

  describe("live tag edits", () => {
    const snapshot = Object.fromEntries(
      listLibraryIcons().map((icon) => [icon.id, [...icon.tags]]),
    );
    afterEach(() => {
      applyIconTagTable(snapshot);
    });

    it("updates tags, search and the version, and notifies subscribers", () => {
      const listener = vi.fn();
      const unsubscribe = subscribeIconLibrary(listener);
      const before = getIconLibraryVersion();

      expect(setLibraryIconTags("play", ["Zzz Tag"])).toBe(true);

      expect(getLibraryIcon("play")?.tags).toEqual(["zzz-tag"]);
      expect(searchLibraryIcons("zzz-tag").map((i) => i.id)).toEqual(["play"]);
      expect(getIconLibraryVersion()).toBe(before + 1);
      expect(listener).toHaveBeenCalledTimes(1);

      // No change, no notification.
      setLibraryIconTags("play", ["zzz-tag"]);
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      setLibraryIconTags("play", ["other"]);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("returns false for unknown ids", () => {
      expect(setLibraryIconTags("nope", ["x"])).toBe(false);
    });

    it("applies a whole table, untagging ids it omits", () => {
      applyIconTagTable({ play: ["from-table"] });
      expect(getLibraryIcon("play")?.tags).toEqual(["from-table"]);
      expect(getLibraryIcon("pause")?.tags).toEqual([]);
      expect(getLibraryIcon("pause")).toBeDefined();
    });
  });
});

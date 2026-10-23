import { describe, expect, it } from "vitest";
import {
  materializeVizTrack,
  registerVizImage,
  retainVizImages,
  splitVizTrack,
  vizTrackCredits,
  type VizFrameTrack,
} from "./vizTrack";

function bitmap(id: string): ImageBitmap {
  const value = { id, close() {} } as unknown as ImageBitmap;
  registerVizImage(id, value);
  return value;
}

describe("vizTrackCredits", () => {
  it("splits performer credits and keeps listed order", () => {
    expect(vizTrackCredits("Portishead;  Massive Attack", "Various")).toEqual([
      { name: "Portishead", key: "Portishead" },
      { name: "Massive Attack", key: "Massive Attack" },
    ]);
  });

  it("falls back to the album artist when the performer field is empty", () => {
    expect(vizTrackCredits(null, "  Björk ")).toEqual([
      { name: "Björk", key: "Björk" },
    ]);
  });

  it("returns no artists when both credits are empty", () => {
    expect(vizTrackCredits("  ", null)).toEqual([]);
  });
});

describe("splitVizTrack", () => {
  it("keeps names on the wire and bitmaps in the media payload", () => {
    const art = bitmap("/art/front.jpg");
    const portrait = bitmap("/artists/bjork.jpg");
    const track: VizFrameTrack = {
      id: 7,
      title: "Hyperballad",
      album: "Post",
      art,
      artColors: ["#e05090"],
      artists: [
        { name: "Björk", portrait },
        { name: "Björk", portrait },
      ],
    };

    const split = splitVizTrack(track);
    const artId = split.wire.artId;
    const portraitId = split.wire.artists[0]?.portraitId;

    expect(artId).toMatch(/^img-\d+$/);
    expect(portraitId).toMatch(/^img-\d+$/);
    expect(portraitId).not.toBe(artId);
    expect(split.wire).toEqual({
      id: 7,
      title: "Hyperballad",
      album: "Post",
      artId,
      artColors: ["#e05090"],
      artists: [
        { name: "Björk", portraitId },
        { name: "Björk", portraitId },
      ],
    });
    expect(split.media.art).toEqual({ id: artId, bitmap: art });
    expect(split.media.portraits).toEqual([
      { id: portraitId, bitmap: portrait },
    ]);
  });

  it("never puts image file paths on the wire", () => {
    const track: VizFrameTrack = {
      id: 8,
      title: "Joga",
      album: "Homogenic",
      art: bitmap("/Users/me/Music/Björk/Homogenic/cover.jpg"),
      artColors: [],
      artists: [
        { name: "Björk", portrait: bitmap("/Users/me/Artists/bjork.jpg") },
      ],
    };
    const split = splitVizTrack(track);
    const serialized =
      JSON.stringify(split.wire) +
      JSON.stringify([
        split.media.art?.id,
        ...split.media.portraits.map((p) => p.id),
      ]);
    expect(serialized).not.toContain("/Users/me");
  });

  it("gives every decode of the same image path the same id", () => {
    const first = bitmap("/art/same.jpg");
    const second = bitmap("/art/same.jpg");
    const track = (art: ImageBitmap): VizFrameTrack => ({
      id: 1,
      title: "",
      album: null,
      art,
      artColors: [],
      artists: [],
    });
    expect(splitVizTrack(track(first)).wire.artId).toBe(
      splitVizTrack(track(second)).wire.artId,
    );
  });

  it("omits a bitmap that was never registered", () => {
    const track: VizFrameTrack = {
      id: null,
      title: "Untitled",
      album: null,
      art: { close() {} } as unknown as ImageBitmap,
      artColors: [],
      artists: [],
    };
    const split = splitVizTrack(track);
    expect(split.wire.artId).toBeNull();
    expect(split.media.art).toBeNull();
  });
});

describe("materializeVizTrack", () => {
  it("attaches cached bitmaps and leaves missing images null", () => {
    const art = bitmap("/art/front.jpg");
    const materialized = materializeVizTrack(
      {
        id: 7,
        title: "Hyperballad",
        album: "Post",
        artId: "/art/front.jpg",
        artColors: ["#e05090"],
        artists: [
          { name: "Björk", portraitId: "/artists/missing.jpg" },
          { name: "Guest", portraitId: null },
        ],
      },
      new Map([["/art/front.jpg", art]]),
      new Map(),
    );

    expect(materialized.art).toBe(art);
    expect(materialized.artists).toEqual([
      { name: "Björk", portrait: null },
      { name: "Guest", portrait: null },
    ]);
  });
});

describe("retainVizImages", () => {
  it("closes bitmaps the current track no longer uses", () => {
    const closed: string[] = [];
    const keep = { close() {} } as unknown as ImageBitmap;
    const drop = {
      close() {
        closed.push("drop");
      },
    } as unknown as ImageBitmap;
    const bitmaps = new Map<string, ImageBitmap>([
      ["/keep.jpg", keep],
      ["/drop.jpg", drop],
    ]);

    retainVizImages(bitmaps, new Set(["/keep.jpg"]));

    expect(closed).toEqual(["drop"]);
    expect([...bitmaps.keys()]).toEqual(["/keep.jpg"]);
  });
});

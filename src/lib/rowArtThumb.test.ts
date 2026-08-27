import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCachedRowArtThumbPath,
  GRID_ART_THUMB_SIZE,
  resolveRowArtThumbPath,
  ROW_ART_THUMB_SIZE,
} from "./rowArtThumb";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => `asset://${path}`,
}));

describe("resolveRowArtThumbPath", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("caches thumbnail paths separately per size", async () => {
    const artPath = `/covers/size-cache-${Math.random()}.jpg`;
    vi.mocked(invoke).mockImplementation(async (_cmd, args) => {
      const { size } = args as { size: number };
      return `/thumbs/${size}.jpg`;
    });

    const row = await resolveRowArtThumbPath(artPath, ROW_ART_THUMB_SIZE);
    const grid = await resolveRowArtThumbPath(artPath, GRID_ART_THUMB_SIZE);

    expect(row).toBe(`/thumbs/${ROW_ART_THUMB_SIZE}.jpg`);
    expect(grid).toBe(`/thumbs/${GRID_ART_THUMB_SIZE}.jpg`);
    expect(getCachedRowArtThumbPath(artPath, ROW_ART_THUMB_SIZE)).toBe(row);
    expect(getCachedRowArtThumbPath(artPath, GRID_ART_THUMB_SIZE)).toBe(grid);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("reuses an in-flight request for the same path and size", async () => {
    const artPath = `/covers/inflight-${Math.random()}.jpg`;
    let release: (path: string) => void = () => {};
    vi.mocked(invoke).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    const first = resolveRowArtThumbPath(artPath, GRID_ART_THUMB_SIZE);
    const second = resolveRowArtThumbPath(artPath, GRID_ART_THUMB_SIZE);
    release("/thumbs/shared.jpg");

    expect(await first).toBe("/thumbs/shared.jpg");
    expect(await second).toBe("/thumbs/shared.jpg");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

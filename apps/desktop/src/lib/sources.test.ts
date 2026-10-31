import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addWatchedSource,
  getLibrary,
  getSourceStatuses,
  listSources,
  relocateWatchedSource,
  removeWatchedSource,
  rescanSource,
  setSourceWritable,
} from "./tauri";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => `asset://${path}`,
  Channel: class {},
}));

describe("source commands", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("pass camelCase arguments the backend commands expect", async () => {
    await listSources();
    await addWatchedSource("/Music/Collection");
    await addWatchedSource("/Music/Jazz", "Jazz");
    await removeWatchedSource(3);
    await rescanSource(1);
    await relocateWatchedSource(3, "/Volumes/Big/Collection");
    await setSourceWritable(3, true);

    expect(vi.mocked(invoke).mock.calls).toEqual([
      ["list_sources"],
      ["add_watched_source", { rootPath: "/Music/Collection", name: null }],
      ["add_watched_source", { rootPath: "/Music/Jazz", name: "Jazz" }],
      ["remove_watched_source", { sourceId: 3 }],
      ["rescan_source", { sourceId: 1 }],
      [
        "relocate_watched_source",
        { sourceId: 3, newRootPath: "/Volumes/Big/Collection" },
      ],
      ["set_source_writable", { sourceId: 3, writable: true }],
    ]);
  });

  it("fetch watch statuses", async () => {
    await getSourceStatuses();
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("get_source_statuses");
  });

  it("keep each track's source and missing mark from the library", async () => {
    vi.mocked(invoke).mockResolvedValue([
      {
        id: 1,
        title: "A",
        filePath: "/m/a.mp3",
        dateAdded: "2026-01-01",
        sourceId: 3,
        missingSince: "2026-10-01T12:00:00Z",
      },
      {
        id: 2,
        title: "B",
        file_path: "/m/b.mp3",
        date_added: "2026-01-01",
        source_id: 1,
      },
    ]);
    const [a, b] = await getLibrary();
    expect(a).toMatchObject({
      sourceId: 3,
      missingSince: "2026-10-01T12:00:00Z",
    });
    expect(b).toMatchObject({ sourceId: 1, missingSince: null });
  });
});

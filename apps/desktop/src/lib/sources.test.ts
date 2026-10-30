import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addWatchedSource,
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
});

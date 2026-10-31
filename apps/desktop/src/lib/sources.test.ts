import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addSource,
  getImportSource,
  getLibrary,
  getSourceStatuses,
  listSources,
  relocateSource,
  removeSource,
  rescanSource,
  setImportSource,
  setSourceOrganize,
  setSourcePathFormat,
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
    await addSource("/Music/Collection");
    await addSource("/Music/Jazz", "Jazz");
    await removeSource(3);
    await rescanSource(1);
    await relocateSource(3, "/Volumes/Big/Collection");
    await setSourceOrganize(3, true);
    await setSourcePathFormat(3, "{artist}/{title}");
    await setSourcePathFormat(3, null);
    await setImportSource(3);
    await getImportSource();

    expect(vi.mocked(invoke).mock.calls).toEqual([
      ["list_sources"],
      ["add_source", { rootPath: "/Music/Collection", name: null }],
      ["add_source", { rootPath: "/Music/Jazz", name: "Jazz" }],
      ["remove_source", { sourceId: 3 }],
      ["rescan_source", { sourceId: 1 }],
      [
        "relocate_source",
        { sourceId: 3, newRootPath: "/Volumes/Big/Collection" },
      ],
      ["set_source_organize", { sourceId: 3, autoOrganize: true }],
      [
        "set_source_path_format",
        { sourceId: 3, pathFormat: "{artist}/{title}" },
      ],
      ["set_source_path_format", { sourceId: 3, pathFormat: null }],
      ["set_import_source", { sourceId: 3 }],
      ["get_import_source"],
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

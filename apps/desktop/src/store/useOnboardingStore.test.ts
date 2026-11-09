import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Source } from "@/types/source";

const tauri = vi.hoisted(() => ({
  createManagedSource: vi.fn(),
  removeSource: vi.fn(),
  getLibrary: vi.fn(),
  listSources: vi.fn(),
  getSourceStatuses: vi.fn(),
}));
vi.mock("@/lib/tauri", () => tauri);
const organize = vi.hoisted(() => ({ organizeInBackground: vi.fn() }));
vi.mock("@/lib/files/organizeSource", () => organize);
vi.mock("./useLibrarySettingsStore", () => ({
  useLibrarySettingsStore: {
    getState: () => ({ settings: { mediaFolder: "/Music/Spiral/Tracks" } }),
  },
}));

const tracks = {
  id: 1,
  name: "Tracks",
  rootPath: "/Music/Spiral/Tracks",
  autoOrganize: true,
  pathFormat: null,
  importTarget: true,
  createdAt: "2026-01-01T00:00:00Z",
} as Source;

const music = {
  ...tracks,
  id: 3,
  name: "Music",
  rootPath: "/Music/Collection",
  autoOrganize: false,
  importTarget: false,
} as Source;

async function freshStore() {
  vi.resetModules();
  return (await import("./useOnboardingStore")).useOnboardingStore;
}

describe("useOnboardingStore", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    vi.clearAllMocks();
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens on first launch", async () => {
    const store = await freshStore();
    expect(store.getState().open).toBe(true);
  });

  it("stays closed once finished, across launches", async () => {
    const store = await freshStore();
    store.getState().finish();
    expect(store.getState().open).toBe(false);

    const next = await freshStore();
    expect(next.getState().open).toBe(false);
  });

  it("can be started again after completion", async () => {
    const store = await freshStore();
    store.getState().finish();
    store.getState().start();
    expect(store.getState().open).toBe(true);
  });

  it("organizes added folders with organizing on once it finishes", async () => {
    const store = await freshStore();
    const { useSourcesStore } = await import("./useSourcesStore");
    const folder = (id: number, autoOrganize: boolean) =>
      ({ ...tracks, id, autoOrganize, importTarget: false }) as Source;
    const sources = [
      tracks,
      folder(3, true),
      folder(4, false),
      folder(5, true),
    ];
    // Tracks (1) wasn't added on the folders step, so it's left alone.
    useSourcesStore.setState({ sources });
    store.getState().noteSourceAdded(3);
    store.getState().noteSourceAdded(4);
    store.getState().noteSourceAdded(5);
    expect(organize.organizeInBackground).not.toHaveBeenCalled();

    store.getState().finish();
    // One batch, so one toast covers every folder.
    expect(organize.organizeInBackground.mock.calls).toEqual([
      [[{ source: sources[1] }, { source: sources[3] }], { scanFirst: true }],
    ]);
  });

  it("adds the folders step only for existing music", async () => {
    const store = await freshStore();
    const { onboardingSteps } = await import("./useOnboardingStore");
    expect(onboardingSteps("new")).toEqual([
      "library",
      "style",
      "privacy",
      "support",
    ]);
    expect(onboardingSteps("existing")).toEqual([
      "library",
      "folders",
      "style",
      "privacy",
      "support",
    ]);

    store.getState().setMusicChoice("existing");
    for (let i = 0; i < 6; i++) store.getState().next();
    expect(store.getState().step).toBe(4);
  });

  it("forgets the answer and added folders when started again", async () => {
    const store = await freshStore();
    store.getState().setMusicChoice("new");
    store.getState().noteSourceAdded(3);
    store.getState().start();
    expect(store.getState().musicChoice).toBeNull();
    expect(store.getState().addedSourceIds).toEqual([]);
  });

  it("tracks folders added and removed on the folders step", async () => {
    const store = await freshStore();
    store.getState().noteSourceAdded(3);
    store.getState().noteSourceAdded(4);
    store.getState().noteSourceRemoved(3);
    expect(store.getState().addedSourceIds).toEqual([4]);
  });

  describe("applying the first answer", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      tauri.listSources.mockResolvedValue([]);
      tauri.getSourceStatuses.mockResolvedValue([]);
      tauri.createManagedSource.mockResolvedValue(tracks);
      tauri.removeSource.mockResolvedValue(0);
      tauri.getLibrary.mockResolvedValue([]);
    });

    it("has Spiral manage the Tracks folder for a new collection", async () => {
      const store = await freshStore();
      store.getState().setMusicChoice("new");
      await store.getState().applyMusicChoice();
      expect(tauri.createManagedSource).toHaveBeenCalled();
      expect(store.getState().placeholderSourceId).toBeNull();
      expect(tauri.removeSource).not.toHaveBeenCalled();
    });

    it("sets a new library's empty Tracks aside for the user's own folders", async () => {
      tauri.listSources.mockResolvedValue([tracks]);
      const store = await freshStore();
      store.getState().setMusicChoice("existing");
      await store.getState().applyMusicChoice();
      expect(tauri.createManagedSource).not.toHaveBeenCalled();
      expect(store.getState().placeholderSourceId).toBe(1);
      expect(tauri.removeSource).not.toHaveBeenCalled();
    });

    it("keeps a Tracks folder that holds tracks", async () => {
      tauri.listSources.mockResolvedValue([tracks]);
      tauri.getLibrary.mockResolvedValue([{ sourceId: 1 }]);
      const store = await freshStore();
      store.getState().setMusicChoice("existing");
      await store.getState().applyMusicChoice();
      expect(store.getState().placeholderSourceId).toBeNull();
    });

    it("keeps Tracks when its track count can't be known", async () => {
      tauri.listSources.mockResolvedValue([tracks]);
      tauri.getLibrary.mockRejectedValue(new Error("no database"));
      const store = await freshStore();
      store.getState().setMusicChoice("existing");
      await store.getState().applyMusicChoice();
      expect(store.getState().placeholderSourceId).toBeNull();
    });

    it("keeps a placeholder that has gained tracks by the time it would go", async () => {
      tauri.listSources.mockResolvedValue([tracks]);
      const store = await freshStore();
      store.getState().setMusicChoice("existing");
      await store.getState().applyMusicChoice();
      expect(store.getState().placeholderSourceId).toBe(1);

      tauri.listSources.mockResolvedValue([tracks, music]);
      const { useSourcesStore } = await import("./useSourcesStore");
      await useSourcesStore.getState().loadSources();
      tauri.getLibrary.mockResolvedValue([{ sourceId: 1 }]);
      await store.getState().settleFolders();
      expect(tauri.removeSource).not.toHaveBeenCalled();
      expect(store.getState().placeholderSourceId).toBeNull();
    });

    it("keeps Tracks when it isn't the only folder", async () => {
      tauri.listSources.mockResolvedValue([tracks, music]);
      const store = await freshStore();
      store.getState().setMusicChoice("existing");
      await store.getState().applyMusicChoice();
      expect(store.getState().placeholderSourceId).toBeNull();
    });

    it("removes the placeholder once a folder of the user's own is added", async () => {
      tauri.listSources.mockResolvedValue([tracks]);
      const store = await freshStore();
      store.getState().setMusicChoice("existing");
      await store.getState().applyMusicChoice();

      // No folder of their own yet: the placeholder stays.
      await store.getState().settleFolders();
      expect(tauri.removeSource).not.toHaveBeenCalled();

      tauri.listSources.mockResolvedValue([tracks, music]);
      const { useSourcesStore } = await import("./useSourcesStore");
      await useSourcesStore.getState().loadSources();
      tauri.listSources.mockResolvedValue([{ ...music, importTarget: true }]);
      await store.getState().settleFolders();
      expect(tauri.removeSource).toHaveBeenCalledWith(1);
      expect(store.getState().placeholderSourceId).toBeNull();
    });

    it("going back to the default keeps the Tracks folder", async () => {
      tauri.listSources.mockResolvedValue([tracks]);
      const store = await freshStore();
      store.getState().setMusicChoice("existing");
      await store.getState().applyMusicChoice();
      store.getState().setMusicChoice("new");
      await store.getState().applyMusicChoice();
      expect(store.getState().placeholderSourceId).toBeNull();
      await store.getState().settleFolders();
      expect(tauri.removeSource).not.toHaveBeenCalled();
    });
  });
});

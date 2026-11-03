import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Source } from "../types/source";

const tauri = vi.hoisted(() => ({
  createManagedSource: vi.fn(),
  removeSource: vi.fn(),
  listSources: vi.fn(),
  getSourceStatuses: vi.fn(),
}));
vi.mock("../lib/tauri", () => tauri);

const tracks = {
  id: 1,
  name: "Tracks",
  rootPath: "/Music/Spiral/Tracks",
  autoOrganize: true,
  pathFormat: null,
  importTarget: true,
  createdAt: "2026-01-01T00:00:00Z",
} as Source;

async function freshStore() {
  vi.resetModules();
  return (await import("./useOnboardingStore")).useOnboardingStore;
}

describe("useOnboardingStore", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
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

  it("adds the folders step only for existing music", async () => {
    const store = await freshStore();
    const { onboardingSteps } = await import("./useOnboardingStore");
    expect(onboardingSteps("new")).toEqual(["library", "style", "privacy"]);
    expect(onboardingSteps("existing")).toEqual([
      "library",
      "folders",
      "style",
      "privacy",
    ]);

    store.getState().setMusicChoice("existing");
    for (let i = 0; i < 5; i++) store.getState().next();
    expect(store.getState().step).toBe(3);
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
    });

    it("has Spiral manage a Tracks folder for a new collection, once", async () => {
      const store = await freshStore();
      store.getState().setMusicChoice("new");
      await store.getState().applyMusicChoice();
      await store.getState().applyMusicChoice();
      expect(tauri.createManagedSource).toHaveBeenCalledTimes(1);
      expect(store.getState().managedSourceId).toBe(1);
      expect(tauri.removeSource).not.toHaveBeenCalled();
    });

    it("makes no Tracks folder for the user's own folders", async () => {
      const store = await freshStore();
      store.getState().setMusicChoice("existing");
      await store.getState().applyMusicChoice();
      expect(tauri.createManagedSource).not.toHaveBeenCalled();
      expect(tauri.removeSource).not.toHaveBeenCalled();
    });

    it("removes the Tracks folder it made when the answer changes to own folders", async () => {
      const store = await freshStore();
      store.getState().setMusicChoice("new");
      await store.getState().applyMusicChoice();
      store.getState().setMusicChoice("existing");
      await store.getState().applyMusicChoice();
      expect(tauri.removeSource).toHaveBeenCalledWith(1);
      expect(store.getState().managedSourceId).toBeNull();
    });

    it("never removes a Tracks folder that was already a source", async () => {
      tauri.listSources.mockResolvedValue([tracks]);
      const store = await freshStore();
      store.getState().setMusicChoice("new");
      await store.getState().applyMusicChoice();
      store.getState().setMusicChoice("existing");
      await store.getState().applyMusicChoice();
      expect(store.getState().managedSourceId).toBeNull();
      expect(tauri.removeSource).not.toHaveBeenCalled();
    });
  });
});

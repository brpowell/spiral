import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
});

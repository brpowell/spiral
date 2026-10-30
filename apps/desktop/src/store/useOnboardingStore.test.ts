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
});

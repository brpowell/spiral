import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/scheduling", () => ({
  afterUiTransition: () => Promise.resolve(),
}));

import { useTagWriteConfirmStore } from "./useTagWriteConfirmStore";

const STORAGE_KEY = "spiral:tagWriteConfirmDismissed";

describe("useTagWriteConfirmStore", () => {
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
    useTagWriteConfirmStore.getState().resetDismissals();
    useTagWriteConfirmStore.setState({ prompt: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens a prompt and resolves with the user's answer", async () => {
    const pending = useTagWriteConfirmStore
      .getState()
      .confirmTagWrite("album", 12);
    expect(useTagWriteConfirmStore.getState().prompt).toMatchObject({
      context: "album",
      fileCount: 12,
    });

    await useTagWriteConfirmStore.getState().answerPrompt(true, false);
    await expect(pending).resolves.toBe(true);
    expect(useTagWriteConfirmStore.getState().prompt).toBeNull();
  });

  it("resolves false when cancelled", async () => {
    const pending = useTagWriteConfirmStore
      .getState()
      .confirmTagWrite("track", 1);
    await useTagWriteConfirmStore.getState().answerPrompt(false, true);
    await expect(pending).resolves.toBe(false);
    expect(useTagWriteConfirmStore.getState().dismissed.track).toBe(false);
  });

  it("skips the prompt once a context is dismissed", async () => {
    const first = useTagWriteConfirmStore
      .getState()
      .confirmTagWrite("track", 5);
    await useTagWriteConfirmStore.getState().answerPrompt(true, true);
    await first;

    await expect(
      useTagWriteConfirmStore.getState().confirmTagWrite("track", 9),
    ).resolves.toBe(true);
    expect(useTagWriteConfirmStore.getState().prompt).toBeNull();
  });

  it("keeps dismissals independent per context", async () => {
    const first = useTagWriteConfirmStore
      .getState()
      .confirmTagWrite("track", 5);
    await useTagWriteConfirmStore.getState().answerPrompt(true, true);
    await first;

    const album = useTagWriteConfirmStore
      .getState()
      .confirmTagWrite("album", 10);
    expect(useTagWriteConfirmStore.getState().prompt?.context).toBe("album");
    await useTagWriteConfirmStore.getState().answerPrompt(false, false);
    await expect(album).resolves.toBe(false);
  });

  it("persists dismissals and resets them", async () => {
    const first = useTagWriteConfirmStore
      .getState()
      .confirmTagWrite("artist", 30);
    await useTagWriteConfirmStore.getState().answerPrompt(true, true);
    await first;
    expect(JSON.parse(storage.get(STORAGE_KEY) ?? "{}")).toMatchObject({
      artist: true,
      album: false,
    });

    useTagWriteConfirmStore.getState().resetDismissals();
    expect(useTagWriteConfirmStore.getState().dismissed.artist).toBe(false);
    expect(JSON.parse(storage.get(STORAGE_KEY) ?? "{}")).toMatchObject({
      artist: false,
    });
  });
});

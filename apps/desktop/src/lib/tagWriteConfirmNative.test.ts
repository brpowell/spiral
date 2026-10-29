import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const message = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: (...args: unknown[]) => message(...args),
}));
vi.mock("./i18n", () => ({
  t: (key: string) => key.split(":").pop(),
}));

import { useTagWriteConfirmStore } from "../store/useTagWriteConfirmStore";
import { confirmTagWriteNative } from "./tagWriteConfirmNative";

describe("confirmTagWriteNative", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    useTagWriteConfirmStore.getState().resetDismissals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("confirms on Save without remembering", async () => {
    message.mockResolvedValue("tagWrite.native.save");
    await expect(confirmTagWriteNative("rating", 1)).resolves.toBe(true);
    expect(useTagWriteConfirmStore.getState().dismissed.rating).toBe(false);
  });

  it("remembers the choice on Save, don't ask again", async () => {
    message.mockResolvedValue("tagWrite.native.saveDontAsk");
    await expect(confirmTagWriteNative("rating", 1)).resolves.toBe(true);
    expect(useTagWriteConfirmStore.getState().dismissed.rating).toBe(true);

    message.mockClear();
    await expect(confirmTagWriteNative("rating", 1)).resolves.toBe(true);
    expect(message).not.toHaveBeenCalled();
  });

  it("returns false on cancel", async () => {
    message.mockResolvedValue("Cancel");
    await expect(confirmTagWriteNative("rating", 1)).resolves.toBe(false);
    expect(useTagWriteConfirmStore.getState().dismissed.rating).toBe(false);
  });
});

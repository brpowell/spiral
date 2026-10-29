import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "../types/track";

const setTrackRating = vi.fn();
const confirmTagWriteNative = vi.fn();

vi.mock("./tauri", () => ({
  setTrackRating: (...args: unknown[]) => setTrackRating(...args),
}));
vi.mock("./tagWriteConfirmNative", () => ({
  confirmTagWriteNative: (...args: unknown[]) => confirmTagWriteNative(...args),
}));
vi.mock("./scheduling", () => ({
  afterUiTransition: () => Promise.resolve(),
}));

import { useTagWriteConfirmStore } from "../store/useTagWriteConfirmStore";
import { confirmAndApplyTrackRatings } from "./applyTrackRating";

const track = (id: number, rating: number) => ({ id, rating }) as Track;

describe("confirmAndApplyTrackRatings", () => {
  const update = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
    });
    setTrackRating.mockResolvedValue(0);
    useTagWriteConfirmStore.getState().resetDismissals();
    useTagWriteConfirmStore.setState({ prompt: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("applies only after the in-app dialog is confirmed", async () => {
    const pending = confirmAndApplyTrackRatings(
      [track(1, 0), track(2, 0)],
      128,
      update,
    );
    expect(useTagWriteConfirmStore.getState().prompt).toMatchObject({
      context: "rating",
      fileCount: 2,
    });
    expect(setTrackRating).not.toHaveBeenCalled();

    await useTagWriteConfirmStore.getState().answerPrompt(true, false);
    await pending;
    expect(setTrackRating).toHaveBeenCalledTimes(2);
  });

  it("leaves ratings alone when cancelled", async () => {
    const pending = confirmAndApplyTrackRatings([track(1, 0)], 128, update);
    await useTagWriteConfirmStore.getState().answerPrompt(false, false);
    await pending;
    expect(setTrackRating).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("skips the prompt once dismissed", async () => {
    useTagWriteConfirmStore.getState().dismissContext("rating");
    await confirmAndApplyTrackRatings([track(1, 0)], 128, update);
    expect(useTagWriteConfirmStore.getState().prompt).toBeNull();
    expect(setTrackRating).toHaveBeenCalledWith(1, 128);
  });

  it("does not prompt when nothing would change", async () => {
    await confirmAndApplyTrackRatings([track(1, 128)], 128, update);
    expect(useTagWriteConfirmStore.getState().prompt).toBeNull();
    expect(setTrackRating).not.toHaveBeenCalled();
  });

  it("uses the native dialog for skins", async () => {
    confirmTagWriteNative.mockResolvedValue(true);
    await confirmAndApplyTrackRatings([track(1, 0)], 128, update, {
      native: true,
    });
    expect(confirmTagWriteNative).toHaveBeenCalledWith("rating", 1);
    expect(useTagWriteConfirmStore.getState().prompt).toBeNull();
    expect(setTrackRating).toHaveBeenCalledWith(1, 128);
  });
});

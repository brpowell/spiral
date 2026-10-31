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

import { useSourcesStore } from "../store/useSourcesStore";
import { useTagWriteConfirmStore } from "../store/useTagWriteConfirmStore";
import type { Source } from "../types/source";
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

  describe("read-only sources", () => {
    // Only Other's loose files are read-only.
    const other: Source = {
      id: 2,
      rootPath: null,
      name: "Other Files",
      autoOrganize: false,
      pathFormat: null,
      importTarget: false,
      createdAt: "2026-01-01T00:00:00Z",
    };
    const readOnly = (id: number, rating: number) =>
      ({ id, rating, sourceId: 2 }) as Track;

    beforeEach(() => {
      useSourcesStore.setState({ sourcesById: new Map([[2, other]]) });
    });

    afterEach(() => {
      useSourcesStore.setState({ sourcesById: new Map() });
    });

    it("rates without prompting when no file will be written", async () => {
      await confirmAndApplyTrackRatings([readOnly(1, 0)], 128, update);
      expect(useTagWriteConfirmStore.getState().prompt).toBeNull();
      expect(setTrackRating).toHaveBeenCalledWith(1, 128);
    });

    it("counts only the files that will be written", async () => {
      const pending = confirmAndApplyTrackRatings(
        [track(1, 0), readOnly(2, 0), readOnly(3, 0)],
        128,
        update,
      );
      expect(useTagWriteConfirmStore.getState().prompt).toMatchObject({
        fileCount: 1,
      });
      await useTagWriteConfirmStore.getState().answerPrompt(true, false);
      await pending;
      expect(setTrackRating).toHaveBeenCalledTimes(3);
    });

    it("skips the native dialog too", async () => {
      await confirmAndApplyTrackRatings([readOnly(1, 0)], 128, update, {
        native: true,
      });
      expect(confirmTagWriteNative).not.toHaveBeenCalled();
      expect(setTrackRating).toHaveBeenCalledWith(1, 128);
    });
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

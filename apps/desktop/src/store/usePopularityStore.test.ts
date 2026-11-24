import { beforeEach, describe, expect, it, vi } from "vitest";

const getTrackPopularity = vi.fn();

vi.mock("@/lib/tauri", () => ({
  getTrackPopularity: (...args: unknown[]) => getTrackPopularity(...args),
}));

import { usePopularityStore } from "./usePopularityStore";
import type { TrackId } from "@/types/track";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("usePopularityStore", () => {
  beforeEach(() => {
    getTrackPopularity.mockReset();
    usePopularityStore.setState({ scores: {}, version: 0, loadedVersion: {} });
  });

  it("loads a profile with its params and caches it per version", async () => {
    getTrackPopularity.mockResolvedValue([{ trackId: "1", score: 2 }]);
    const { load } = usePopularityStore.getState();

    await load("trending");
    await load("trending");

    expect(getTrackPopularity).toHaveBeenCalledTimes(1);
    expect(getTrackPopularity).toHaveBeenCalledWith({ halfLifeDays: 45 });
    expect(usePopularityStore.getState().scores.trending?.get("1")).toBe(2);
  });

  it("passes a null half-life through for the all-time profile", async () => {
    getTrackPopularity.mockResolvedValue([]);
    await usePopularityStore.getState().load("allTime");
    expect(getTrackPopularity).toHaveBeenCalledWith({ halfLifeDays: null });
  });

  it("reloads after invalidate and keeps old scores meanwhile", async () => {
    getTrackPopularity.mockResolvedValueOnce([{ trackId: "1", score: 1 }]);
    await usePopularityStore.getState().load("trending");

    usePopularityStore.getState().invalidate();
    const next = deferred<{ trackId: TrackId; score: number }[]>();
    getTrackPopularity.mockReturnValueOnce(next.promise);
    const pending = usePopularityStore.getState().load("trending");

    expect(usePopularityStore.getState().scores.trending?.get("1")).toBe(1);

    next.resolve([{ trackId: "1", score: 5 }]);
    await pending;
    expect(usePopularityStore.getState().scores.trending?.get("1")).toBe(5);
  });

  it("does not start a duplicate request while one is in flight", async () => {
    const first = deferred<{ trackId: TrackId; score: number }[]>();
    getTrackPopularity.mockReturnValueOnce(first.promise);
    const { load } = usePopularityStore.getState();

    const a = load("favorites");
    const b = load("favorites");
    first.resolve([]);
    await Promise.all([a, b]);

    expect(getTrackPopularity).toHaveBeenCalledTimes(1);
  });

  it("discards a response that was superseded by an invalidate", async () => {
    const stale = deferred<{ trackId: TrackId; score: number }[]>();
    getTrackPopularity.mockReturnValueOnce(stale.promise);
    const pending = usePopularityStore.getState().load("trending");

    usePopularityStore.getState().invalidate();
    stale.resolve([{ trackId: "1", score: 99 }]);
    await pending;

    expect(usePopularityStore.getState().scores.trending).toBeUndefined();
  });

  it("leaves scores unset when the backend call fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    getTrackPopularity.mockRejectedValue(new Error("boom"));
    await usePopularityStore.getState().load("trending");
    expect(usePopularityStore.getState().scores.trending).toBeUndefined();
    error.mockRestore();
  });
});

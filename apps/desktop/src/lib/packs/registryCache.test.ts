import { describe, expect, it, vi } from "vitest";
import { createRegistryCache } from "./registryCache";

type Result = { ok: true; n: number } | { ok: false };

function setup(ttlMs = 1000) {
  let time = 0;
  const cache = createRegistryCache<Result>({ ttlMs, now: () => time });
  return { cache, advance: (ms: number) => (time += ms) };
}

describe("createRegistryCache", () => {
  it("serves a fresh hit without calling the loader again", async () => {
    const { cache } = setup();
    const load = vi.fn(async (): Promise<Result> => ({ ok: true, n: 1 }));
    await cache.get("a", load);
    await expect(cache.get("a", load)).resolves.toEqual({ ok: true, n: 1 });
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.peek("a")).toEqual({ ok: true, n: 1 });
  });

  it("reloads after the TTL expires", async () => {
    const { cache, advance } = setup(1000);
    const load = vi
      .fn<() => Promise<Result>>()
      .mockResolvedValueOnce({ ok: true, n: 1 })
      .mockResolvedValueOnce({ ok: true, n: 2 });
    await cache.get("a", load);
    advance(1000);
    expect(cache.peek("a")).toBeUndefined();
    await expect(cache.get("a", load)).resolves.toEqual({ ok: true, n: 2 });
  });

  it("does not cache failures", async () => {
    const { cache } = setup();
    const load = vi
      .fn<() => Promise<Result>>()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, n: 1 });
    await expect(cache.get("a", load)).resolves.toEqual({ ok: false });
    await expect(cache.get("a", load)).resolves.toEqual({ ok: true, n: 1 });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent loads for the same key", async () => {
    const { cache } = setup();
    let resolve!: (r: Result) => void;
    const load = vi.fn(
      () => new Promise<Result>((r) => (resolve = r)),
    );
    const first = cache.get("a", load);
    const second = cache.get("a", load);
    resolve({ ok: true, n: 1 });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true, n: 1 },
      { ok: true, n: 1 },
    ]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("force bypasses a fresh entry and refreshes it", async () => {
    const { cache } = setup();
    const load = vi
      .fn<() => Promise<Result>>()
      .mockResolvedValueOnce({ ok: true, n: 1 })
      .mockResolvedValueOnce({ ok: true, n: 2 });
    await cache.get("a", load);
    await expect(cache.get("a", load, { force: true })).resolves.toEqual({
      ok: true,
      n: 2,
    });
    expect(cache.peek("a")).toEqual({ ok: true, n: 2 });
  });

  it("honours a custom cacheable predicate", async () => {
    const cache = createRegistryCache<Result>({
      ttlMs: 1000,
      cacheable: () => false,
    });
    const load = vi.fn(async (): Promise<Result> => ({ ok: true, n: 1 }));
    await cache.get("a", load);
    await cache.get("a", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("clear drops entries and ignores loads that were in flight", async () => {
    const { cache } = setup();
    let resolve!: (r: Result) => void;
    const pending = cache.get("a", () => new Promise<Result>((r) => (resolve = r)));
    cache.clear();
    resolve({ ok: true, n: 1 });
    await pending;
    expect(cache.peek("a")).toBeUndefined();
  });

  it("evicts the oldest entry past maxEntries", async () => {
    const cache = createRegistryCache<Result>({ ttlMs: 1000, maxEntries: 2 });
    for (const key of ["a", "b", "c"]) {
      await cache.get(key, async () => ({ ok: true, n: 1 }));
    }
    expect(cache.peek("a")).toBeUndefined();
    expect(cache.peek("b")).toBeDefined();
    expect(cache.peek("c")).toBeDefined();
  });
});

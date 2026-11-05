import { afterEach, describe, expect, it, vi } from "vitest";
import { getLibraryIcon, setLibraryIconTags } from "../../lib/iconLibrary";
import { ICON_TAGS_ENDPOINT, saveIconTags } from "./saveIconTags";

const original = [...(getLibraryIcon("play")?.tags ?? [])];

afterEach(() => {
  setLibraryIconTags("play", original);
});

function response(ok: boolean, body: unknown, statusText = "") {
  return {
    ok,
    statusText,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("saveIconTags", () => {
  it("applies tags in memory and posts the normalized list", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(true, { ok: true }));

    const result = await saveIconTags(
      "play",
      ["Zzz", " zzz ", "Test Tag"],
      fetchImpl,
    );

    expect(result).toEqual({ ok: true });
    expect(getLibraryIcon("play")?.tags).toEqual(["zzz", "test-tag"]);
    expect(fetchImpl).toHaveBeenCalledWith(ICON_TAGS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "play", tags: ["zzz", "test-tag"] }),
    });
  });

  it("reports the server's error but keeps the in-memory change", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        response(false, { error: "disk full" }, "Server Error"),
      );

    const result = await saveIconTags("play", ["zzz"], fetchImpl);

    expect(result).toEqual({ ok: false, error: "disk full" });
    expect(getLibraryIcon("play")?.tags).toEqual(["zzz"]);
  });

  it("reports a network failure", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await saveIconTags("play", ["zzz"], fetchImpl)).toEqual({
      ok: false,
      error: "offline",
    });
  });

  it("refuses unknown icons without calling the server", async () => {
    const fetchImpl = vi.fn();
    const result = await saveIconTags("nope", ["zzz"], fetchImpl);
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

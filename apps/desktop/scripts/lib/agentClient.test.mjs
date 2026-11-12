import { describe, expect, it } from "vitest";
import os from "node:os";
import { assertOwned, runtimeDir } from "./agentClient.mjs";

const stat = ({ uid = 1000, dir = false, mode = 0o700 } = {}) => ({
  uid,
  mode,
  isDirectory: () => dir,
});

describe("runtimeDir", () => {
  it("prefers XDG_RUNTIME_DIR", () => {
    expect(runtimeDir({ XDG_RUNTIME_DIR: "/run/user/1000" })).toBe(
      "/run/user/1000",
    );
  });

  it("falls back to the temp dir when unset or empty", () => {
    expect(runtimeDir({})).toBe(os.tmpdir());
    expect(runtimeDir({ XDG_RUNTIME_DIR: "" })).toBe(os.tmpdir());
  });
});

describe("assertOwned", () => {
  it("accepts a socket or private folder owned by the current user", () => {
    expect(() => assertOwned("/s", stat(), 1000)).not.toThrow();
    expect(() => assertOwned("/d", stat({ dir: true }), 1000)).not.toThrow();
  });

  it("rejects anything owned by another user", () => {
    expect(() => assertOwned("/s", stat({ uid: 1001 }), 1000)).toThrow(
      /owned by uid 1001/,
    );
  });

  it("rejects a folder others can write to", () => {
    expect(() =>
      assertOwned("/d", stat({ dir: true, mode: 0o777 }), 1000),
    ).toThrow(/writable by other users/);
  });
});

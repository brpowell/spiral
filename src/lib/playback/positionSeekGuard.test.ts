import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PositionSeekGuard } from "./positionSeekGuard";

describe("PositionSeekGuard", () => {
  beforeEach(() => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts position updates when no seek is pending", () => {
    const guard = new PositionSeekGuard();
    expect(guard.shouldAccept(42)).toBe(true);
  });

  it("rejects stale positions until the seek target is confirmed", () => {
    const guard = new PositionSeekGuard(1.5, 2500);
    guard.noteSeek(120);

    expect(guard.shouldAccept(45)).toBe(false);
    expect(guard.shouldAccept(46.2)).toBe(false);
    expect(guard.shouldAccept(119.5)).toBe(true);
    // Confirmed — subsequent reports apply normally.
    expect(guard.shouldAccept(45)).toBe(true);
  });

  it("accepts after timeout even if still far from the seek target", () => {
    const guard = new PositionSeekGuard(1.5, 2500);
    guard.noteSeek(120);

    expect(guard.shouldAccept(45, 1000)).toBe(false);
    expect(guard.shouldAccept(45, 3501)).toBe(true);
  });

  it("clear drops a pending seek", () => {
    const guard = new PositionSeekGuard();
    guard.noteSeek(90);
    guard.clear();
    expect(guard.shouldAccept(10)).toBe(true);
  });

  it("noteSeek replaces a previous pending seek", () => {
    const guard = new PositionSeekGuard(1.5, 2500);
    guard.noteSeek(30);
    guard.noteSeek(90);

    expect(guard.shouldAccept(30.1)).toBe(false);
    expect(guard.shouldAccept(89.2)).toBe(true);
  });
});

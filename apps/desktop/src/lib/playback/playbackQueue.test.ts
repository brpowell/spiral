import { describe, expect, it } from "vitest";
import { restoreSequentialOrder } from "./playbackQueue";

describe("restoreSequentialOrder", () => {
  it("returns the remembered order when it covers the same tracks", () => {
    expect(restoreSequentialOrder([3, 1, 2], [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("returns a copy, not the stored array", () => {
    const sequential = [1, 2, 3];
    expect(restoreSequentialOrder([2, 3, 1], sequential)).not.toBe(sequential);
  });

  it("returns null when nothing was remembered", () => {
    expect(restoreSequentialOrder([1, 2, 3], null)).toBeNull();
  });

  it("returns null when the set list changed since", () => {
    expect(restoreSequentialOrder([3, 1], [1, 2, 3])).toBeNull();
    expect(restoreSequentialOrder([1, 2, 4], [1, 2, 3])).toBeNull();
  });
});

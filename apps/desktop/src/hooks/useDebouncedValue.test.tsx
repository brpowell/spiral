import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedValue } from "./useDebouncedValue";

describe("useDebouncedValue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the initial value immediately and settles on the last value", () => {
    const { result, rerender } = renderHook(
      ({ v }) => useDebouncedValue(v, 150),
      { initialProps: { v: "" } },
    );
    expect(result.current).toBe("");

    rerender({ v: "r" });
    rerender({ v: "ra" });
    rerender({ v: "rad" });
    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(result.current).toBe("");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe("rad");
  });
});

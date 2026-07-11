// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useInputEditHistory } from "./useInputEditHistory";

describe("useInputEditHistory", () => {
  it("restores values removed by cut-style edits", () => {
    const { result } = renderHook(() => useInputEditHistory());

    act(() => result.current.reset("hello world"));
    act(() => result.current.recordChange(" world"));

    let restored: string | null = null;
    act(() => {
      restored = result.current.undo();
    });

    expect(restored).toBe("hello world");
  });

  it("does not push an extra undo entry when syncing after undo", () => {
    const { result } = renderHook(() => useInputEditHistory());

    act(() => result.current.reset("hello"));
    act(() => result.current.recordChange("hello world"));

    act(() => {
      result.current.undo();
    });
    act(() => {
      result.current.recordChange("hello");
    });

    let restored: string | null = null;
    act(() => {
      restored = result.current.undo();
    });

    expect(restored).toBe(null);
  });
});

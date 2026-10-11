import { afterEach, describe, expect, it } from "vitest";
import {
  isTopModalLayer,
  popModalLayer,
  pushModalLayer,
  resetModalStack,
} from "./modalStack";

afterEach(() => {
  resetModalStack();
});

describe("modalStack", () => {
  it("treats the most recently pushed layer as top", () => {
    const first = pushModalLayer();
    const second = pushModalLayer();

    expect(isTopModalLayer(first)).toBe(false);
    expect(isTopModalLayer(second)).toBe(true);

    popModalLayer(second);
    expect(isTopModalLayer(first)).toBe(true);
  });

  it("removes a layer from the middle without promoting the wrong one", () => {
    const first = pushModalLayer();
    const middle = pushModalLayer();
    const top = pushModalLayer();

    popModalLayer(middle);
    expect(isTopModalLayer(top)).toBe(true);
    expect(isTopModalLayer(first)).toBe(false);
  });
});

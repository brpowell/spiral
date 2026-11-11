import { describe, expect, it, vi } from "vitest";
import {
  clientPointInViewport,
  createIgnoreCursorState,
  decidePolledPassThrough,
} from "./skinClickThrough";
import { isViewStateMotionActive } from "./skinViewStateEvents";

describe("createIgnoreCursorState", () => {
  it("skips a native call when the flag is unchanged", async () => {
    const apply = vi.fn(() => Promise.resolve());
    const state = createIgnoreCursorState(apply);
    state.set(true);
    state.set(true);
    await Promise.resolve();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(state.ignoring).toBe(true);
  });

  it("rolls back after a refused call so the next poll retries", async () => {
    const apply = vi
      .fn<(ignore: boolean) => Promise<void>>()
      .mockRejectedValueOnce(new Error("skin window is not mapped yet"))
      .mockResolvedValue(undefined);
    const state = createIgnoreCursorState(apply);
    state.set(true);
    await vi.waitFor(() => expect(state.ignoring).toBe(false));
    state.set(true);
    await Promise.resolve();
    expect(apply).toHaveBeenCalledTimes(2);
    expect(state.ignoring).toBe(true);
  });
});

describe("clientPointInViewport", () => {
  const viewport = { width: 760, height: 394 };

  it("rejects the out-of-window poll points that stuck ignore-cursor", () => {
    expect(clientPointInViewport(2263.41, -853.39, viewport)).toBe(false);
    expect(clientPointInViewport(390.2, -156.97, viewport)).toBe(false);
  });

  it("accepts a point on Headspace chrome", () => {
    expect(clientPointInViewport(363.91, 38.14, viewport)).toBe(true);
  });
});

describe("decidePolledPassThrough", () => {
  it("holds when the mapped point is outside the viewport", () => {
    expect(
      decidePolledPassThrough({
        inView: false,
        overContent: false,
        stayInteractive: false,
        buttonsDown: false,
      }),
    ).toBe("hold");
  });

  it("ignores only for an in-view hole", () => {
    expect(
      decidePolledPassThrough({
        inView: true,
        overContent: false,
        stayInteractive: false,
        buttonsDown: false,
      }),
    ).toBe("ignore");
  });

  it("stays interactive over chrome or while suspended", () => {
    expect(
      decidePolledPassThrough({
        inView: true,
        overContent: true,
        stayInteractive: false,
        buttonsDown: false,
      }),
    ).toBe("interactive");
    expect(
      decidePolledPassThrough({
        inView: false,
        overContent: false,
        stayInteractive: true,
        buttonsDown: false,
      }),
    ).toBe("interactive");
  });

  it("holds ignore while a mouse button is down, even over a hole", () => {
    expect(
      decidePolledPassThrough({
        inView: true,
        overContent: false,
        stayInteractive: false,
        buttonsDown: true,
      }),
    ).toBe("hold");
  });

  it("keeps pointer-driven interaction ahead of a held button", () => {
    expect(
      decidePolledPassThrough({
        inView: true,
        overContent: true,
        stayInteractive: true,
        buttonsDown: true,
      }),
    ).toBe("interactive");
  });
});

describe("isViewStateMotionActive", () => {
  it("is false when every variable is settled", () => {
    expect(isViewStateMotionActive({ eq: "open", shutter: "closed" })).toBe(
      false,
    );
  });

  it("is true while a variable is mid-motion", () => {
    expect(isViewStateMotionActive({ eq: "opening" })).toBe(true);
    expect(isViewStateMotionActive({ eq: "closing" })).toBe(true);
  });
});

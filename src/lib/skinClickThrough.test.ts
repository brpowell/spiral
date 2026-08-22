import { describe, expect, it } from "vitest";
import {
  clientPointInViewport,
  decidePolledPassThrough,
} from "./skinClickThrough";
import { isViewStateMotionActive } from "./skinViewStateEvents";

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
      }),
    ).toBe("hold");
  });

  it("ignores only for an in-view hole", () => {
    expect(
      decidePolledPassThrough({
        inView: true,
        overContent: false,
        stayInteractive: false,
      }),
    ).toBe("ignore");
  });

  it("stays interactive over chrome or while suspended", () => {
    expect(
      decidePolledPassThrough({
        inView: true,
        overContent: true,
        stayInteractive: false,
      }),
    ).toBe("interactive");
    expect(
      decidePolledPassThrough({
        inView: false,
        overContent: false,
        stayInteractive: true,
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

import { describe, expect, it } from "vitest";
import { applyViewStateEvent } from "./skinViewStateEvents";
import type { SkinViewStateSpec } from "../types/skin";
import type { SkinViewStateApi } from "./skinViewStateContext";

const shutterToggle = [
  { from: ["intro", "closed"], set: "opening" },
  { from: ["open"], set: "closing" },
];

const shutterStateSpec: Record<string, SkinViewStateSpec> = {
  shutter: {
    default: "intro",
    on: { toggle: shutterToggle },
  },
};

function mockViewState(initial: Record<string, string | number | boolean>): {
  api: SkinViewStateApi;
  values: Record<string, string | number | boolean>;
} {
  const values = { ...initial };
  const api: SkinViewStateApi = {
    values,
    setVariable: (name, value) => {
      values[name] = value;
    },
    setScreen: (screen) => {
      values.screen = screen;
    },
    reset: () => {},
  };
  return { api, values };
}

describe("applyViewStateEvent", () => {
  it("transitions intro and closed to opening", () => {
    const { api, values } = mockViewState({ shutter: "intro" });

    expect(
      applyViewStateEvent("shutter", "toggle", shutterStateSpec, api),
    ).toBe(true);
    expect(values.shutter).toBe("opening");

    values.shutter = "closed";
    applyViewStateEvent("shutter", "toggle", shutterStateSpec, api);
    expect(values.shutter).toBe("opening");
  });

  it("transitions open to closing", () => {
    const { api, values } = mockViewState({ shutter: "open" });

    expect(
      applyViewStateEvent("shutter", "toggle", shutterStateSpec, api),
    ).toBe(true);
    expect(values.shutter).toBe("closing");
  });

  it("no-ops while animating", () => {
    const { api, values } = mockViewState({ shutter: "opening" });

    expect(
      applyViewStateEvent("shutter", "toggle", shutterStateSpec, api),
    ).toBe(false);
    expect(values.shutter).toBe("opening");

    values.shutter = "closing";
    expect(
      applyViewStateEvent("shutter", "toggle", shutterStateSpec, api),
    ).toBe(false);
  });

  it("returns false when event or variable is unknown", () => {
    const { api } = mockViewState({ shutter: "open" });

    expect(
      applyViewStateEvent("shutter", "missing", shutterStateSpec, api),
    ).toBe(false);
    expect(
      applyViewStateEvent("unknown", "toggle", shutterStateSpec, api),
    ).toBe(false);
  });

  it("matches wildcard branch when from is omitted", () => {
    const spec: Record<string, SkinViewStateSpec> = {
      mode: { default: "a", on: { next: [{ set: "done" }] } },
    };
    const { api, values } = mockViewState({ mode: "anything" });

    expect(applyViewStateEvent("mode", "next", spec, api)).toBe(true);
    expect(values.mode).toBe("done");
  });
});
